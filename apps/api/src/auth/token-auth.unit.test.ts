import { expect, test, describe } from "bun:test";
import { Hono } from "hono";
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
			headers: { Authorization: "Bearer pck_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
		});
		expect(res.status).toBe(401);
	});
});
