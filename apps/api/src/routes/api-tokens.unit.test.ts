import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { apiTokenRoutes } from "./api-tokens.ts";

/**
 * Creates a test app with session auth mocked.
 * The token routes require session-based auth (user logged in via browser).
 */
function createTokenApp(mockUser: Record<string, unknown> | null = null) {
	const app = new Hono<AuthEnv>();

	// Mock session middleware + requireAuth
	app.use("*", async (c, next) => {
		c.set("user", mockUser as AuthEnv["Variables"]["user"]);
		c.set(
			"session",
			mockUser
				? ({ id: "test-session" } as AuthEnv["Variables"]["session"])
				: null,
		);
		await next();
	});

	app.route("/api/v1/tokens", apiTokenRoutes);
	return app;
}

describe("Token management — sin sesión", () => {
	const app = createTokenApp(null);

	test("POST /api/v1/tokens → 401 sin sesión", async () => {
		const res = await app.request("/api/v1/tokens", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Mi token" }),
		});
		expect(res.status).toBe(401);
	});

	test("GET /api/v1/tokens → 401 sin sesión", async () => {
		const res = await app.request("/api/v1/tokens");
		expect(res.status).toBe(401);
	});
});

describe("Token management — con sesión", () => {
	const app = createTokenApp({
		id: "user-1",
		role: "author",
		email: "test@example.com",
		name: "Test",
	});

	test("POST /api/v1/tokens → 201 crea token", async () => {
		const res = await app.request("/api/v1/tokens", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Mi token de prueba" }),
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.id).toBeDefined();
		expect(body.token).toBeDefined();
		expect(body.token.startsWith("pck_")).toBe(true);
		expect(body.name).toBe("Mi token de prueba");
		expect(body.message).toContain("Guarda");
	});

	test("POST /api/v1/tokens → 400 sin nombre", async () => {
		const res = await app.request("/api/v1/tokens", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	test("GET /api/v1/tokens → 200 lista tokens", async () => {
		// Create a token first
		await app.request("/api/v1/tokens", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Listed token" }),
		});

		const res = await app.request("/api/v1/tokens");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body.data)).toBe(true);
		expect(body.data.length).toBeGreaterThan(0);
		// Raw token should NOT be in the list
		expect(body.data[0].token).toBeUndefined();
		expect(body.data[0].tokenPrefix).toBeDefined();
	});

	test("DELETE /api/v1/tokens/:id → 200 revoca token", async () => {
		const createRes = await app.request("/api/v1/tokens", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "To revoke" }),
		});
		const { id } = await createRes.json();

		const res = await app.request(`/api/v1/tokens/${id}`, { method: "DELETE" });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.revoked).toBe(true);
	});
});
