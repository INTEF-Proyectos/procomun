import { describe, expect, test } from "bun:test";
import * as repo from "@procomun/db/repository";
import { Hono } from "hono";
import { getDb, waitForDb } from "../db.ts";
import type { AuthEnv } from "./middleware.ts";
import { tokenAuthMiddleware } from "./token-auth.ts";

describe("tokenAuthMiddleware", () => {
	function createTestApp() {
		const app = new Hono<AuthEnv>();
		app.use("*", async (c, next) => {
			c.set("user", null);
			c.set("session", null);
			await next();
		});
		app.use("*", tokenAuthMiddleware);
		app.get("/test", (c) => {
			const user = c.get("user");
			return c.json({ userId: user?.id ?? null });
		});
		return app;
	}

	test("returns 401 without Authorization header", async () => {
		const app = createTestApp();
		const res = await app.request("/test");
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toContain("Token");
	});

	test("returns 401 with invalid Authorization format", async () => {
		const app = createTestApp();
		const res = await app.request("/test", {
			headers: { Authorization: "Basic abc123" },
		});
		expect(res.status).toBe(401);
	});

	test("returns 401 with too-short token", async () => {
		const app = createTestApp();
		const res = await app.request("/test", {
			headers: { Authorization: "Bearer short" },
		});
		expect(res.status).toBe(401);
	});

	test("returns 401 with non-existent token", async () => {
		const app = createTestApp();
		const res = await app.request("/test", {
			headers: {
				Authorization: "Bearer pck_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			},
		});
		expect(res.status).toBe(401);
	});

	test("el rate limit se cuenta por usuario, no por token", async () => {
		// El límite debe compartirse entre todos los tokens del mismo usuario.
		// Si se contara por token, rotar de token reiniciaría la cuota y eludiría
		// el límite. Creamos dos tokens del MISMO usuario: agotamos la cuota con el
		// primero y el primer uso del segundo ya debe rechazarse (101 combinadas).
		await waitForDb();
		const db = getDb().db;
		const userId = `rl-${crypto.randomUUID()}`;
		await repo.ensureUser(db, {
			id: userId,
			email: `${userId}@example.com`,
			name: "RL",
			role: "author",
		});
		const token1 = await repo.createApiToken(db, {
			userId,
			name: "rl-token-1",
		});
		const token2 = await repo.createApiToken(db, {
			userId,
			name: "rl-token-2",
		});

		const app = createTestApp();

		// 100 peticiones con el token 1: dentro de la cuota (100/min) → 200.
		let lastStatus = 0;
		for (let i = 0; i < 100; i++) {
			const res = await app.request("/test", {
				headers: { Authorization: `Bearer ${token1.rawToken}` },
			});
			lastStatus = res.status;
		}
		expect(lastStatus).toBe(200);

		// Primera petición con el token 2 (mismo usuario) → es la 101ª combinada → 429.
		const res = await app.request("/test", {
			headers: { Authorization: `Bearer ${token2.rawToken}` },
		});
		expect(res.status).toBe(429);
	});
});
