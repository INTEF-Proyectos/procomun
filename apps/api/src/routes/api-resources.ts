import * as repo from "@procomun/db/repository";
import {
	validateCreateResource,
	validateUpdateResource,
} from "@procomun/db/validation";
import { Hono } from "hono";
import { logActivity } from "../activity/log.ts";
import type { AuthEnv } from "../auth/middleware.ts";
import { canManageResource } from "../auth/roles.ts";
import { getDb } from "../db.ts";

const apiResourceRoutes = new Hono<AuthEnv>();

// POST /api/v1/resources — Create a new resource
apiResourceRoutes.post("/", async (c) => {
	const user = c.get("user");
	if (!user) return c.json({ error: "No autenticado" }, 401);

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: "El cuerpo debe ser JSON válido" }, 400);
	}

	// En esta API (ADR-0024) author era opcional: si falta o viene vacío, firma
	// el dueño del token para no romper a los clientes que ya publican.
	if (body && typeof body === "object") {
		const input = body as Record<string, unknown>;
		if (
			input.author == null ||
			(typeof input.author === "string" && !input.author.trim())
		) {
			input.author = user.name;
		}
	}

	const validation = validateCreateResource(body);
	if (!validation.valid) {
		return c.json(
			{ error: "Errores de validación", details: validation.errors },
			400,
		);
	}

	const data = body as Record<string, unknown>;
	const db = getDb().db;

	// Ensure user exists in DB
	await repo.ensureUser(db, {
		id: user.id,
		email: user.email ?? "",
		name: user.name ?? null,
	});

	const editorialStatus =
		data.editorialStatus === "review" ? "review" : "draft";

	const result = await repo.createResource(db, {
		title: data.title as string,
		description: data.description as string,
		language: data.language as string,
		license: data.license as string,
		resourceType: data.resourceType as string,
		keywords: (data.keywords as string) ?? undefined,
		author: (data.author as string) ?? undefined,
		otherAuthors: (data.otherAuthors as string) ?? undefined,
		publisher: (data.publisher as string) ?? undefined,
		subjects: (data.subjects as string[]) ?? undefined,
		levels: (data.levels as string[]) ?? undefined,
		educationalAreas: data.educationalAreas,
		createdBy: user.id,
		editorialStatus,
	});

	await logActivity({
		userId: user.id,
		type: "resource_created",
		resourceId: result.id,
		resourceTitle: data.title as string,
		resourceSlug: result.slug,
		description: `Recurso creado vía API: «${data.title}»`,
	});

	return c.json({ id: result.id, slug: result.slug, editorialStatus }, 201);
});

// GET /api/v1/resources/:id — Get resource status
apiResourceRoutes.get("/:id", async (c) => {
	const user = c.get("user");
	if (!user) return c.json({ error: "No autenticado" }, 401);

	const { id } = c.req.param();
	const db = getDb().db;
	const resource = await repo.getResourceById(db, id);

	if (!resource) {
		return c.json({ error: "Recurso no encontrado" }, 404);
	}

	if (!canManageResource(user, resource)) {
		return c.json({ error: "Recurso no encontrado" }, 404);
	}

	return c.json({
		id: resource.id,
		slug: resource.slug,
		title: resource.title,
		description: resource.description,
		language: resource.language,
		license: resource.license,
		resourceType: resource.resourceType,
		keywords: resource.keywords,
		author: resource.author,
		otherAuthors: resource.otherAuthors,
		publisher: resource.publisher,
		editorialStatus: resource.editorialStatus,
		catalogKeywords: resource.catalogKeywords,
		educationalAreas: resource.educationalAreas,
		createdAt: resource.createdAt,
		updatedAt: resource.updatedAt,
	});
});

// PUT /api/v1/resources/:id — Update own resource
apiResourceRoutes.put("/:id", async (c) => {
	const user = c.get("user");
	if (!user) return c.json({ error: "No autenticado" }, 401);

	const { id } = c.req.param();
	const db = getDb().db;
	const resource = await repo.getResourceById(db, id);

	if (!resource) {
		return c.json({ error: "Recurso no encontrado" }, 404);
	}

	if (!canManageResource(user, resource)) {
		return c.json(
			{ error: "No tienes permisos para modificar este recurso" },
			403,
		);
	}

	let body: unknown;
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: "El cuerpo debe ser JSON válido" }, 400);
	}

	const validation = validateUpdateResource(body);
	if (!validation.valid) {
		return c.json(
			{ error: "Errores de validación", details: validation.errors },
			400,
		);
	}

	const data = body as Record<string, unknown>;
	await repo.updateResource(db, id, data);

	await logActivity({
		userId: user.id,
		type: "resource_updated",
		resourceId: id,
		resourceTitle: (data.title as string) ?? resource.title,
		resourceSlug: resource.slug,
		description: `Recurso actualizado vía API: «${(data.title as string) ?? resource.title}»`,
	});

	return c.json({ id, updated: true });
});

// DELETE /api/v1/resources/:id — Soft-delete own resource
apiResourceRoutes.delete("/:id", async (c) => {
	const user = c.get("user");
	if (!user) return c.json({ error: "No autenticado" }, 401);

	const { id } = c.req.param();
	const db = getDb().db;
	const resource = await repo.getResourceById(db, id);

	if (!resource) {
		return c.json({ error: "Recurso no encontrado" }, 404);
	}

	if (!canManageResource(user, resource)) {
		return c.json(
			{ error: "No tienes permisos para eliminar este recurso" },
			403,
		);
	}

	await repo.deleteResource(db, id);

	await logActivity({
		userId: user.id,
		type: "resource_deleted",
		resourceId: id,
		resourceTitle: resource.title,
		resourceSlug: resource.slug,
		description: `Recurso eliminado vía API: «${resource.title}»`,
	});

	return c.json({ id, deleted: true });
});

export { apiResourceRoutes };
