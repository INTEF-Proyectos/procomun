import * as repo from "@procomun/db/repository";
import { Hono } from "hono";
import { type AuthEnv, requireRole } from "../../auth/middleware.ts";
import { getDb } from "../../db.ts";

const adminApiTokensRoutes = new Hono<AuthEnv>();

adminApiTokensRoutes.use("*", requireRole("admin"));

adminApiTokensRoutes.get("/", async (c) => {
	const userId = c.req.query("userId") || undefined;
	const statusRaw = c.req.query("status");
	const status =
		statusRaw === "active" || statusRaw === "revoked" || statusRaw === "expired"
			? statusRaw
			: undefined;

	const tokens = await repo.listAllApiTokens(getDb().db, { userId, status });
	return c.json(tokens);
});

adminApiTokensRoutes.delete("/:id", async (c) => {
	const { id } = c.req.param();
	await repo.revokeApiTokenAdmin(getDb().db, id);
	return c.json({ success: true });
});

adminApiTokensRoutes.get("/stats", async (c) => {
	const stats = await repo.getGlobalApiTokenStats(getDb().db);
	return c.json(stats);
});

export { adminApiTokensRoutes };
