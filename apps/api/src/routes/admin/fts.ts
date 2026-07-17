import { Hono } from "hono";
import { type AuthEnv, requireRole } from "../../auth/middleware.ts";
import { getDb } from "../../db.ts";
import { reindexAllResources, reindexResource } from "../../fts/search.ts";
import { reExtractResource } from "../../fts/worker.ts";

const ftsRoutes = new Hono<AuthEnv>();

// Reindex a single resource (update search_vector from current data)
ftsRoutes.post("/reindex/:id", requireRole("admin"), async (c) => {
	const id = c.req.param("id");
	if (!id) return c.json({ error: "Falta id" }, 400);
	const db = getDb().db;
	await reindexResource(db, id);
	return c.json({ id, reindexed: true });
});

// Re-extract text and reindex a single resource
ftsRoutes.post("/re-extract/:id", requireRole("admin"), async (c) => {
	const id = c.req.param("id");
	if (!id) return c.json({ error: "Falta id" }, 400);
	await reExtractResource(id);
	return c.json({ id, reExtracted: true });
});

// Reindex all resources (batch update search_vectors)
ftsRoutes.post("/reindex-all", requireRole("admin"), async (c) => {
	const db = getDb().db;
	const result = await reindexAllResources(db);
	return c.json({ reindexed: result.processed });
});

export { ftsRoutes };
