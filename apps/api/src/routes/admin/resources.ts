import * as repo from "@procomun/db/repository";
import {
	validateCreateResource,
	validateResourceForStatus,
	validateResourceUpdateForStatus,
	validateStatus,
	validateTransition,
	validateUpdateResource,
} from "@procomun/db/validation";
import { validationSealOnStatusChange } from "@procomun/db/validation-seal";
import { Hono } from "hono";
import { logActivity } from "../../activity/log.ts";
import { type AuthEnv, requireRole } from "../../auth/middleware.ts";
import {
	canManageResource,
	getCurrentUser,
	hasMinRole,
} from "../../auth/roles.ts";
import { ensureCurrentUser } from "../../auth/user-sync.ts";
import { getDb } from "../../db.ts";
import { elpxPreviewUrlForStatus } from "../../elpx/preview-token.ts";
import { updateSearchVector } from "../../fts/search.ts";
import { onPublicContentChanged } from "../../resources/validation-seal.ts";
import { retireUploadArtifacts } from "../../services/elpx-retire.ts";
import { thumbnailUrlForStatus } from "../../thumbnails/access.ts";
import { contentDisposition, getUploadConfig } from "../../uploads/config.ts";
import { buildCrudRoutes } from "../crud-builder.ts";
import { readUploadContent, terminateUpload } from "../uploads.ts";
import {
	parseJsonBodyOrNull,
	requireManageableResource,
	requireUploadSessionForManagedResource,
} from "./guards.ts";
import { registerResourceVersionRoutes } from "./versions.ts";

const db = () => getDb().db;

// --- Upload routes (montadas en /uploads por admin/index.ts) ---

const adminUploadRoutes = new Hono<AuthEnv>();

adminUploadRoutes.get("/config", async (c) => {
	// No exponer storageDir (ruta absoluta interna del servidor) al cliente.
	const { storageDir: _storageDir, ...clientConfig } = getUploadConfig();
	return c.json(clientConfig);
});

adminUploadRoutes.use("/:id/*", requireRole("author"));

adminUploadRoutes.delete("/:id", requireRole("author"), async (c) => {
	const user = getCurrentUser(c);
	const id = c.req.param("id");
	if (!id) return c.json({ error: "Falta id" }, 400);
	const check = await requireUploadSessionForManagedResource(c, id);
	if ("response" in check) return check.response;

	await terminateUpload(id, user);
	return c.json({ id, cancelled: true });
});

adminUploadRoutes.get("/:id/content", async (c) => {
	const id = c.req.param("id");
	if (!id) return c.json({ error: "Falta id" }, 400);
	const check = await requireUploadSessionForManagedResource(c, id);
	if ("response" in check) return check.response;

	const body = await readUploadContent(id);
	return c.body(body, 200, {
		"Content-Type": check.data.session.mimeType ?? "application/octet-stream",
		"Content-Disposition": contentDisposition(
			"inline",
			check.data.session.originalFilename,
		),
	});
});

// --- Resource CRUD (montadas en /resources por admin/index.ts) ---

/**
 * Revisión de #481: el backoffice ve recursos en cualquier estado y la preview
 * legacy de lo no publicado solo sale firmada. `listFilters` y `canManage` ya
 * dejan fuera lo que el usuario no puede ver. `thumbnailUrl` no es editable,
 * así que el enlace firmado nunca vuelve a la base de datos.
 */
function withThumbnailForStatus<
	T extends { thumbnailUrl: string | null; editorialStatus: string },
>(resource: T): T {
	return {
		...resource,
		thumbnailUrl: thumbnailUrlForStatus(
			resource.thumbnailUrl,
			resource.editorialStatus,
		),
	};
}

const resourceRoutes = buildCrudRoutes({
	baseRole: "author",
	list: async (db, opts) => {
		const result = await repo.listResources(
			db,
			opts as Parameters<typeof repo.listResources>[1],
		);
		return { ...result, data: result.data.map(withThumbnailForStatus) };
	},
	getById: async (db, id) => {
		const resource = await repo.getResourceById(db, id);
		return resource ? withThumbnailForStatus(resource) : null;
	},
	create: (db, data) =>
		repo.createResource(db, data as Parameters<typeof repo.createResource>[1]),
	update: async (db, id, data, user) => {
		await repo.updateResource(
			db,
			id,
			data as Parameters<typeof repo.updateResource>[2],
		);
		// #420: si edita el autor, el recurso pierde el sello «Validado».
		await onPublicContentChanged(db, id, user);
	},
	remove: repo.deleteResource,
	validateCreate: validateCreateResource,
	validateUpdate: validateUpdateResource,
	canManage: canManageResource,
	listFilters: (user, params) => {
		const isAdmin = hasMinRole(user.role, "admin");
		const isCurator = !isAdmin && hasMinRole(user.role, "curator");
		return {
			status: params.status,
			createdBy: isAdmin || isCurator ? undefined : user.id,
			// #460: el curator no ve los borradores ajenos (misma regla que
			// canViewResource/canManageResource).
			hideOthersDraftsFor: isCurator ? user.id : undefined,
		};
	},
	prepareCreate: async (body, user) => {
		await ensureCurrentUser(user);
		// Whitelist explícito: el alta desde el backoffice NUNCA acepta
		// editorialStatus/featuredAt/assignedCuratorId/slug/… del cuerpo (mass
		// assignment). El recurso nace como borrador (createResource por defecto)
		// y solo cambia de estado vía PATCH /:id/status con validateTransition.
		return {
			...repo.pickEditableResourceFields(body),
			subjects: Array.isArray(body.subjects) ? body.subjects : undefined,
			levels: Array.isArray(body.levels) ? body.levels : undefined,
			keywordIds: body.keywordIds,
			educationalAreas: Array.isArray(body.educationalAreas)
				? body.educationalAreas
				: undefined,
			// #448: el repositorio comprueba que existan, estén activas y, las
			// familias, que el recurso sea de FP.
			knowledgeAreaIds: body.knowledgeAreaIds,
			professionalFamilyIds: body.professionalFamilyIds,
			createdBy: user.id,
		};
	},
	// #448: un recurso en revisión o publicado no se queda sin áreas.
	validateUpdateWith: (entity, body) =>
		validateResourceUpdateForStatus(
			entity as Parameters<typeof validateResourceUpdateForStatus>[0],
			body,
		),
	afterCreate: async (user, result, data) => {
		const r = result as { id: string; slug: string };
		await logActivity({
			userId: user.id,
			type: "resource_created",
			resourceId: r.id,
			resourceTitle: (data as { title?: string }).title ?? null,
			resourceSlug: r.slug,
			description: `Creaste el recurso «${(data as { title?: string }).title}»`,
		});
		// Update search vector for the new resource
		await updateSearchVector(db(), r.id);
	},
	afterUpdate: async (user, id, entity, _data) => {
		const r = entity as { title?: string; slug?: string };
		await logActivity({
			userId: user.id,
			type: "resource_updated",
			resourceId: id,
			resourceTitle: r.title ?? null,
			resourceSlug: r.slug ?? null,
			description: `Actualizaste el recurso «${r.title}»`,
		});
		// Re-generate search vector on metadata update
		await updateSearchVector(db(), id);
	},
	afterDelete: async (user, id, entity) => {
		const r = entity as { title?: string; slug?: string };
		await logActivity({
			userId: user.id,
			type: "resource_deleted",
			resourceId: id,
			resourceTitle: r.title ?? null,
			resourceSlug: r.slug ?? null,
			description: `Eliminaste el recurso «${r.title}»`,
		});
	},
	notFoundMessage: "Recurso no encontrado",
});

// --- Draft creation (bypasses required-field validation) ---

resourceRoutes.post("/draft", requireRole("author"), async (c) => {
	const user = getCurrentUser(c);
	await ensureCurrentUser(user);
	const result = await repo.createResource(db(), {
		title: "Nuevo recurso",
		description: " ",
		language: "es",
		license: "cc-by",
		resourceType: "actividad-interactiva",
		editorialStatus: "draft",
		createdBy: user.id,
		// Precarga editable: el editor exige autor al crear (issue #382).
		author: user.name,
	});
	return c.json(result, 201);
});

// --- Sub-resource routes (custom, appended to resourceRoutes) ---

resourceRoutes.get("/:id/media", async (c) => {
	const id = c.req.param("id");
	if (!id) return c.json({ error: "Falta id" }, 400);
	const check = await requireManageableResource(c, id);
	if ("response" in check) return check.response;
	const items = await repo.listMediaItemsForResource(db(), id);
	// Rewrite URLs to the admin endpoint so authenticated users can download
	// files regardless of the resource's editorial status.
	const adminItems = items.map((item) => ({
		...item,
		url: item.url.replace(/^\/api\/v1\/uploads\//, "/api/admin/uploads/"),
	}));
	return c.json(adminItems);
});

resourceRoutes.delete("/:id/media/:mediaItemId", async (c) => {
	const id = c.req.param("id");
	const mediaItemId = c.req.param("mediaItemId");
	if (!id) return c.json({ error: "Falta id" }, 400);
	if (!mediaItemId) return c.json({ error: "Falta mediaItemId" }, 400);
	const check = await requireManageableResource(c, id);
	if ("response" in check) return check.response;

	const items = await repo.listMediaItemsForResource(db(), id);
	const item = items.find((m) => m.id === mediaItemId);
	if (!item) return c.json({ error: "Archivo no encontrado" }, 404);

	const config = getUploadConfig();
	if (item.uploadId) {
		// Conserva archivo y sesión si pertenecen a una versión publicada (issue #31)
		await retireUploadArtifacts(db(), item.uploadId, config);
	}
	await repo.deleteMediaItem(db(), mediaItemId);
	await onPublicContentChanged(db(), id, getCurrentUser(c));

	return c.json({ id: mediaItemId, deleted: true });
});

resourceRoutes.get("/:id/uploads", async (c) => {
	const id = c.req.param("id");
	if (!id) return c.json({ error: "Falta id" }, 400);
	const check = await requireManageableResource(c, id);
	if ("response" in check) return check.response;
	return c.json(await repo.listUploadSessionsForResource(db(), id));
});

resourceRoutes.get("/:id/elpx", async (c) => {
	const id = c.req.param("id");
	if (!id) return c.json({ error: "Falta id" }, 400);
	const check = await requireManageableResource(c, id);
	if ("response" in check) return check.response;

	// El editor debe abrir el ELPX de la versión vigente tras una restauración,
	// no simplemente el último proyecto creado para el recurso.
	const elpx = await repo.getCurrentElpxProjectByResourceId(db(), id);
	if (!elpx)
		return c.json(
			{ error: "Este recurso no tiene un proyecto eXeLearning asociado" },
			404,
		);

	// Find the raw .elpx download URL from the upload session or media item
	let elpxFileUrl: string | null = null;
	if (elpx.uploadSessionId) {
		elpxFileUrl = `/api/admin/uploads/${elpx.uploadSessionId}/content`;
	} else {
		// Fallback: find the media item for this resource with .elpx filename
		const mediaItems = await repo.listMediaItemsForResource(db(), id);
		const elpxMedia = mediaItems.find(
			(m: { filename?: string | null }) =>
				m.filename?.endsWith(".elpx") || m.filename?.endsWith(".elp"),
		);
		if (elpxMedia) elpxFileUrl = elpxMedia.url;
	}

	const metadata = elpx.elpxMetadata ?? null;
	return c.json({
		id: elpx.id,
		hash: elpx.hash,
		hasPreview: elpx.hasPreview,
		previewUrl: elpx.hasPreview
			? elpxPreviewUrlForStatus(elpx.hash, check.data.editorialStatus)
			: null,
		elpxFileUrl,
		metadata,
		originalFilename: elpx.originalFilename,
		version: elpx.version,
		createdAt: elpx.createdAt,
	});
});

// Historial de versiones (issue #31): /:id/versions, publicar y restaurar.
registerResourceVersionRoutes(resourceRoutes);

resourceRoutes.patch("/:id/status", async (c) => {
	const user = getCurrentUser(c);
	const id = c.req.param("id");
	if (!id) return c.json({ error: "Falta id" }, 400);
	const body = await parseJsonBodyOrNull<{ status?: string }>(c);
	if (!body) return c.json({ error: "Cuerpo inválido" }, 400);
	const status = body.status;
	if (typeof status !== "string") {
		return c.json(
			{
				error: "Validación fallida",
				details: [{ field: "status", message: "El estado es obligatorio" }],
			},
			400,
		);
	}

	const validation = validateStatus(status);
	if (!validation.valid)
		return c.json(
			{ error: "Validación fallida", details: validation.errors },
			400,
		);

	const check = await requireManageableResource(c, id);
	if ("response" in check) return check.response;
	const existing = check.data;

	const userRole = user.role ?? "reader";
	const transitionCheck = validateTransition(
		existing.editorialStatus,
		status,
		userRole,
	);
	if (!transitionCheck.valid)
		return c.json(
			{ error: "Transición no permitida", details: transitionCheck.errors },
			403,
		);

	// Issue #408: revisión y publicación exigen los mismos campos que el alta
	// y, desde #448, al menos un área de conocimiento.
	const completeness = validateResourceForStatus(existing, status);
	if (!completeness.valid)
		return c.json(
			{ error: "Validación fallida", details: completeness.errors },
			400,
		);

	// #420: «Aprobar y publicar» (review → published) pone el sello
	// «Validado»; volver a borrador lo quita.
	await repo.updateEditorialStatus(db(), id, status, user.id, {
		validationSeal: validationSealOnStatusChange(
			existing.editorialStatus,
			status,
		),
	});

	const statusLabels: Record<string, string> = {
		draft: "borrador",
		review: "revisión",
		published: "publicado",
		archived: "archivado",
	};
	const activityType =
		status === "published"
			? "resource_published"
			: status === "draft"
				? "resource_drafted"
				: "resource_status_changed";
	await logActivity({
		userId: user.id,
		type: activityType,
		resourceId: id,
		resourceTitle: existing.title,
		resourceSlug: existing.slug,
		description: `Cambiaste el estado de «${existing.title}» a ${statusLabels[status] ?? status}`,
		metadata: { oldStatus: existing.editorialStatus, newStatus: status },
	});

	return c.json({ id, status });
});

export { adminUploadRoutes, resourceRoutes };
