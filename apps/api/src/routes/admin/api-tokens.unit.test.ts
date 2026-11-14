import { beforeEach, describe, expect, test } from "bun:test";
// Sin mock.module de ../../db.ts: en Bun ese mock vale para todo el proceso y
// no se deshace al acabar el fichero. Los ficheros que corrían después recibían
// esta BD sin los usuarios del preload ("1", "system") y fallaban con
// resources_created_by_fkey, según el orden en que se ejecutaran.
import { getDb } from "../../db.ts";

const { db: isolatedDb } = getDb();

import {
	createApiToken,
	ensureUser,
	listAllApiTokens,
} from "@procomun/db/repository";
import { Hono } from "hono";
import type { AuthEnv } from "../../auth/middleware.ts";
import { adminApiTokensRoutes } from "./api-tokens.ts";

function createAdminApiTokensApp(
	mockUser: Record<string, unknown> | null = null,
) {
	const app = new Hono<AuthEnv>();
	app.use("*", async (c, next) => {
		c.set("user", mockUser as AuthEnv["Variables"]["user"]);
		c.set(
			"session",
			mockUser ? ({ id: "s" } as AuthEnv["Variables"]["session"]) : null,
		);
		await next();
	});
	app.route("/api/admin/api-tokens", adminApiTokensRoutes);
	return app;
}

describe("Admin API Tokens routes", () => {
	beforeEach(async () => {
		// Emails propios de este fichero: la BD es compartida y ensureUser hace
		// onConflictDoNothing. Si otro test ya creó author@example.com con otro
		// id (uploads.unit.test.ts usa "upload-author"), user-2 no se crea y
		// createApiToken falla con api_tokens_user_id_fkey.
		await ensureUser(isolatedDb, {
			id: "admin-1",
			email: "api-tokens-admin@example.com",
			name: "Admin User",
			role: "admin",
		});
		await ensureUser(isolatedDb, {
			id: "user-2",
			email: "api-tokens-author@example.com",
			name: "Author User",
			role: "author",
		});
	});

	test("GET /api/admin/api-tokens lists all tokens for admin", async () => {
		const app = createAdminApiTokensApp({ id: "admin-1", role: "admin" });

		// Create some tokens
		const token1 = await createApiToken(isolatedDb, {
			userId: "user-2",
			name: "Token A",
		});

		const res = await app.request("/api/admin/api-tokens");
		expect(res.status).toBe(200);
		// Solo se tipan los campos que viajan intactos por JSON (las fechas de
		// listAllApiTokens llegan serializadas como string, no como Date).
		const body = (await res.json()) as Array<
			Pick<Awaited<ReturnType<typeof listAllApiTokens>>[number], "id" | "user">
		>;
		expect(Array.isArray(body)).toBe(true);
		expect(body.length).toBeGreaterThan(0);
		const found = body.find((t) => t.id === token1.id);
		expect(found).toBeDefined();
		expect(found?.user.name).toBe("Author User");
	});

	test("GET /api/admin/api-tokens rejects non-admin", async () => {
		const app = createAdminApiTokensApp({ id: "user-2", role: "author" });

		const res = await app.request("/api/admin/api-tokens");
		expect(res.status).toBe(403);
	});

	test("DELETE /api/admin/api-tokens/:id revokes token", async () => {
		const app = createAdminApiTokensApp({ id: "admin-1", role: "admin" });
		const token1 = await createApiToken(isolatedDb, {
			userId: "user-2",
			name: "Token to Revoke",
		});

		const res = await app.request(`/api/admin/api-tokens/${token1.id}`, {
			method: "DELETE",
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);

		// Verify revoked in database
		const all = await listAllApiTokens(isolatedDb, { userId: "user-2" });
		const found = all.find((t) => t.id === token1.id);
		expect(found?.revokedAt).not.toBeNull();
	});

	test("GET /api/admin/api-tokens/stats returns stats", async () => {
		const app = createAdminApiTokensApp({ id: "admin-1", role: "admin" });

		const res = await app.request("/api/admin/api-tokens/stats");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.activeCount).toBeDefined();
		expect(body.revokedCount).toBeDefined();
		expect(body.totalRequests).toBeDefined();
	});
});
