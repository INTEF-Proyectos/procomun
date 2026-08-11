import * as repo from "@procomun/db/repository";
import type { Hono } from "hono";
import { logActivity } from "../../activity/log.ts";
import type { AuthEnv } from "../../auth/middleware.ts";
import { getCurrentUser, hasMinRole } from "../../auth/roles.ts";
import { getDb } from "../../db.ts";
import { updateSearchVector } from "../../fts/search.ts";
import { parseJsonBodyOrNull, requireManageableResource } from "./guards.ts";

const db = () => getDb().db;

function buildDownloadUrl(uploadSessionId: string | null): string | null {
	return uploadSessionId
		? `/api/admin/uploads/${uploadSessionId}/content`
		: null;
}

/**
 * Historial de versiones de recursos (issue #31 / ADR-0037).
 * Se registran sobre el router de /api/admin/resources.
 */
export function registerResourceVersionRoutes(routes: Hono<AuthEnv>) {
	// Historial navegable (RF-004/RF-005): número, fecha, autor, notas, vigente.
	routes.get("/:id/versions", async (c) => {
		const id = c.req.param("id");
		if (!id) return c.json({ error: "Falta id" }, 400);
		const check = await requireManageableResource(c, id);
		if ("response" in check) return check.response;

		const versions = await repo.listResourceVersions(db(), id);
		return c.json(
			versions.map((version) => ({
				...version,
				downloadUrl: buildDownloadUrl(version.uploadSessionId),
			})),
		);
	});

	// Publicar nueva versión (RF-001..RF-003) desde la copia de trabajo (.elpx
	// más reciente). Los cambios de metadatos sin nueva entrega no crean versión.
	routes.post("/:id/versions", async (c) => {
		const user = getCurrentUser(c);
		const id = c.req.param("id");
		if (!id) return c.json({ error: "Falta id" }, 400);
		const check = await requireManageableResource(c, id);
		if ("response" in check) return check.response;
		const resource = check.data;

		const body =
			(await parseJsonBodyOrNull<{ changeNotes?: unknown }>(c)) ?? {};
		const changeNotes =
			typeof body.changeNotes === "string" && body.changeNotes.trim()
				? body.changeNotes.trim()
				: null;

		const workingCopy = await repo.getElpxProjectByResourceId(db(), id);
		if (!workingCopy) {
			return c.json(
				{ error: "Este recurso no tiene un proyecto eXeLearning asociado" },
				404,
			);
		}

		const alreadyPublished = await repo.countVersionsReferencingElpxProject(
			db(),
			workingCopy.id,
		);
		if (alreadyPublished > 0) {
			return c.json(
				{
					error:
						"No hay una nueva entrega que publicar: la última subida ya forma parte del historial",
				},
				409,
			);
		}

		const version = await repo.publishResourceVersion(db(), {
			resourceId: id,
			elpxProjectId: workingCopy.id,
			changeNotes,
			createdBy: user.id,
		});

		await logActivity({
			userId: user.id,
			type: "resource_version_published",
			resourceId: id,
			resourceTitle: resource.title,
			resourceSlug: resource.slug,
			description: `Publicaste la versión ${version.versionNumber} de «${resource.title}»`,
			metadata: { versionNumber: version.versionNumber },
		});

		return c.json(version, 201);
	});

	// Restauración no destructiva (RF-007): solo curador/admin. Crea una versión
	// nueva a partir del snapshot elegido; nunca reescribe el historial.
	routes.post("/:id/versions/:versionId/restore", async (c) => {
		const user = getCurrentUser(c);
		const id = c.req.param("id");
		const versionId = c.req.param("versionId");
		if (!id || !versionId) return c.json({ error: "Falta id" }, 400);
		const check = await requireManageableResource(c, id);
		if ("response" in check) return check.response;
		const resource = check.data;

		if (!hasMinRole(user.role, "curator")) {
			return c.json({ error: "Permisos insuficientes" }, 403);
		}

		const target = await repo.getResourceVersionById(db(), versionId);
		if (!target || target.resourceId !== id) {
			return c.json({ error: "Versión no encontrada" }, 404);
		}

		const restored = await repo.restoreResourceVersion(db(), {
			resourceId: id,
			versionId,
			createdBy: user.id,
		});

		// La proyección cambió: re-indexar la búsqueda con los metadatos restaurados.
		await updateSearchVector(db(), id);

		await logActivity({
			userId: user.id,
			type: "resource_version_restored",
			resourceId: id,
			resourceTitle: resource.title,
			resourceSlug: resource.slug,
			description: `Restauraste «${resource.title}» a la versión ${restored.restoredFromVersionNumber}`,
			metadata: {
				versionNumber: restored.versionNumber,
				restoredFromVersionNumber: restored.restoredFromVersionNumber,
			},
		});

		return c.json(restored);
	});
}
