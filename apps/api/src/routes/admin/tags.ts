import * as repo from "@procomun/db/repository";
import { canViewResource } from "@procomun/db/validation";
import { Hono } from "hono";
import { logActivity } from "../../activity/log.ts";
import type { AuthEnv } from "../../auth/middleware.ts";
import {
	canManageResource,
	getCurrentUser,
	hasMinRole,
} from "../../auth/roles.ts";
import { getDb } from "../../db.ts";
import { parsePagination } from "../../http/pagination.ts";

const tagAdminRoutes = new Hono<AuthEnv>();

tagAdminRoutes.get("/", async (c) => {
	const { limit, offset, search } = parsePagination(c);
	return c.json(
		await repo.listTags(getDb().db, {
			limit,
			offset,
			search,
			// includeSynonyms=1 → list all; default canonical only
			canonicalOnly: c.req.query("includeSynonyms") !== "1",
		}),
	);
});

tagAdminRoutes.post("/merge", async (c) => {
	const user = getCurrentUser(c);
	if (!hasMinRole(user.role, "curator")) {
		return c.json({ error: "Forbidden" }, 403);
	}
	const body = (await c.req.json().catch(() => null)) as {
		sourceId?: string;
		targetId?: string;
	} | null;
	if (!body?.sourceId || !body?.targetId) {
		return c.json({ error: "sourceId and targetId are required" }, 400);
	}

	try {
		const result = await repo.mergeTags(
			getDb().db,
			body.sourceId,
			body.targetId,
		);
		await logActivity({
			userId: user.id,
			type: "tag_merged",
			description: `Merged tag ${body.sourceId} into ${body.targetId}`,
			metadata: {
				sourceId: body.sourceId,
				targetId: body.targetId,
				reassigned: result.reassigned,
			},
		});
		return c.json(result);
	} catch (err) {
		if (err instanceof repo.TagNotFoundError) {
			return c.json({ error: err.message }, 404);
		}
		if (err instanceof repo.TagMergeError) {
			return c.json({ error: err.message }, 400);
		}
		throw err;
	}
});

tagAdminRoutes.post("/migrate-keywords", async (c) => {
	const user = getCurrentUser(c);
	if (!hasMinRole(user.role, "admin")) {
		return c.json({ error: "Forbidden" }, 403);
	}
	const stats = await repo.migrateKeywordsToTags(getDb().db);
	await logActivity({
		userId: user.id,
		type: "tags_migrated",
		description: `Migrated keywords to tags (${stats.resourcesProcessed} resources)`,
		metadata: stats,
	});
	return c.json(stats);
});

tagAdminRoutes.get("/resources/:resourceId", async (c) => {
	const resourceId = c.req.param("resourceId");
	if (!resourceId) return c.json({ error: "Missing resourceId" }, 400);
	const resource = await repo.getResourceById(getDb().db, resourceId);
	// #460: un borrador ajeno no existe para el curator.
	if (!resource || !canViewResource(getCurrentUser(c), resource)) {
		return c.json({ error: "Resource not found" }, 404);
	}
	const data = await repo.listResourceTags(getDb().db, resourceId);
	return c.json({ data });
});

/** Set tags on a resource by labels (author+ who can manage the resource). */
tagAdminRoutes.put("/resources/:resourceId", async (c) => {
	const user = getCurrentUser(c);
	const resourceId = c.req.param("resourceId");
	if (!resourceId) return c.json({ error: "Missing resourceId" }, 400);

	const resource = await repo.getResourceById(getDb().db, resourceId);
	if (!resource) return c.json({ error: "Resource not found" }, 404);

	// Misma regla que el resto de la edición del recurso (#460): el curator no
	// toca los borradores ajenos.
	if (!canManageResource(user, resource)) {
		return c.json({ error: "Forbidden" }, 403);
	}

	const body = (await c.req.json().catch(() => null)) as {
		labels?: string[];
	} | null;
	if (!body || !Array.isArray(body.labels)) {
		return c.json({ error: "labels array is required" }, 400);
	}

	const tags = await repo.setResourceTagsByLabels(
		getDb().db,
		resourceId,
		body.labels,
	);
	return c.json({ data: tags });
});

tagAdminRoutes.get("/:id/similar", async (c) => {
	const id = c.req.param("id");
	if (!id) return c.json({ error: "Missing id" }, 400);
	try {
		const data = await repo.listSimilarTagsFor(getDb().db, id, {
			maxDistance: Number(c.req.query("maxDistance") ?? "2") || 2,
			limit: Number(c.req.query("limit") ?? "10") || 10,
		});
		return c.json({ data });
	} catch (err) {
		if (err instanceof repo.TagNotFoundError) {
			return c.json({ error: "Tag not found" }, 404);
		}
		throw err;
	}
});

tagAdminRoutes.get("/:id", async (c) => {
	const id = c.req.param("id");
	if (!id) return c.json({ error: "Missing id" }, 400);
	const tag = await repo.getTagById(getDb().db, id);
	if (!tag) return c.json({ error: "Tag not found" }, 404);
	return c.json(tag);
});

tagAdminRoutes.patch("/:id", async (c) => {
	const user = getCurrentUser(c);
	if (!hasMinRole(user.role, "curator")) {
		return c.json({ error: "Forbidden" }, 403);
	}
	const id = c.req.param("id");
	if (!id) return c.json({ error: "Missing id" }, 400);
	const body = (await c.req.json().catch(() => null)) as {
		label?: string;
		description?: string | null;
	} | null;
	if (!body) return c.json({ error: "Invalid JSON body" }, 400);

	try {
		const updated = await repo.updateTag(getDb().db, id, body);
		await logActivity({
			userId: user.id,
			type: "tag_updated",
			description: `Updated tag «${updated.label}»`,
			metadata: { tagId: id },
		});
		return c.json(updated);
	} catch (err) {
		if (err instanceof repo.TagNotFoundError) {
			return c.json({ error: "Tag not found" }, 404);
		}
		if (err instanceof Error && err.message.includes("required")) {
			return c.json({ error: err.message }, 400);
		}
		throw err;
	}
});

tagAdminRoutes.delete("/:id", async (c) => {
	const user = getCurrentUser(c);
	if (!hasMinRole(user.role, "curator")) {
		return c.json({ error: "Forbidden" }, 403);
	}
	const id = c.req.param("id");
	if (!id) return c.json({ error: "Missing id" }, 400);
	const reassignTo = c.req.query("reassignTo") ?? undefined;

	try {
		await repo.deleteTag(getDb().db, id, { reassignToId: reassignTo });
		await logActivity({
			userId: user.id,
			type: "tag_deleted",
			description: `Deleted tag ${id}`,
			metadata: { tagId: id, reassignTo },
		});
		return c.json({ ok: true });
	} catch (err) {
		if (err instanceof repo.TagNotFoundError) {
			return c.json({ error: "Tag not found" }, 404);
		}
		if (err instanceof repo.TagMergeError) {
			return c.json({ error: err.message }, 400);
		}
		throw err;
	}
});

export { tagAdminRoutes };
