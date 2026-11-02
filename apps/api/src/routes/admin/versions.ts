import * as repo from "@procomun/db/repository";
import type { Context, Hono } from "hono";
import { logActivity } from "../../activity/log.ts";
import type { AuthEnv } from "../../auth/middleware.ts";
import { getCurrentUser, hasMinRole } from "../../auth/roles.ts";
import { getDb } from "../../db.ts";
import { elpxPreviewUrlForStatus } from "../../elpx/preview-token.ts";
import { updateSearchVector } from "../../fts/search.ts";
import {
	remainingPathAfter,
	serveElpxExtractedContent,
} from "../elpx-content.ts";
import { requireManageableResource } from "./guards.ts";

const db = () => getDb().db;

function buildDownloadUrl(uploadSessionId: string | null): string | null {
	return uploadSessionId
		? `/api/admin/uploads/${uploadSessionId}/content`
		: null;
}

function buildAdminPreviewUrl(resourceId: string, versionId: string): string {
	return `/api/admin/resources/${resourceId}/versions/${versionId}/preview/`;
}

function buildPreviewUrl(
	resourceId: string,
	versionId: string,
	hash: string | null,
	hasPreview: boolean | null,
	isCurrent: boolean,
	editorialStatus: string,
): string | null {
	if (!hash || !hasPreview) return null;
	if (isCurrent) return elpxPreviewUrlForStatus(hash, editorialStatus);
	return buildAdminPreviewUrl(resourceId, versionId);
}

/** Historial de versiones de recursos (issue #31 / ADR-0039). */
export function registerResourceVersionRoutes(routes: Hono<AuthEnv>) {
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
				previewUrl: buildPreviewUrl(
					id,
					version.id,
					version.elpxHash,
					version.hasPreview,
					Boolean(version.isCurrent),
					check.data.editorialStatus,
				),
			})),
		);
	});

	async function handleHistoricalPreview(c: Context<AuthEnv>) {
		const id = c.req.param("id");
		const versionId = c.req.param("versionId");
		if (!id || !versionId) return c.json({ error: "Falta id" }, 400);
		const check = await requireManageableResource(c, id);
		if ("response" in check) return check.response;

		const target = await repo.getResourceVersionById(db(), versionId);
		if (!target || target.resourceId !== id) {
			return c.json({ error: "Versión no encontrada" }, 404);
		}

		const history = await repo.listResourceVersions(db(), id);
		const version = history.find((item) => item.id === versionId);
		if (!version?.elpxHash || !version.hasPreview) {
			return c.json({ error: "Previsualización no disponible" }, 404);
		}

		const rewriteBaseUrl = buildAdminPreviewUrl(id, versionId);
		return serveElpxExtractedContent({
			hash: version.elpxHash,
			rawFile: remainingPathAfter(new URL(c.req.url).pathname, "preview"),
			rewriteBaseUrl,
			corsLocalScripts: false,
		});
	}

	routes.get("/:id/versions/:versionId/preview", handleHistoricalPreview);
	routes.get("/:id/versions/:versionId/preview/*", handleHistoricalPreview);

	// Restauración no destructiva: solo curador/admin. Crea una nueva versión
	// desde la seleccionada; nunca reescribe el historial.
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
