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

describe("Token management — tope de tokens activos", () => {
	// Usuario aislado (id único) para que el recuento de tokens activos empiece en 0
	// y no se contamine con los tokens creados por otros tests del fichero.
	const capUserId = `cap-${crypto.randomUUID()}`;
	const app = createTokenApp({
		id: capUserId,
		role: "author",
		email: `${capUserId}@example.com`,
		name: "Cap",
	});

	test("POST /api/v1/tokens → 201 hasta el tope (10) y 403 en el 11º", async () => {
		// Los 10 primeros tokens deben crearse correctamente.
		for (let i = 0; i < 10; i++) {
			const res = await app.request("/api/v1/tokens", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: `Token ${i + 1}` }),
			});
			expect(res.status).toBe(201);
		}

		// El 11º supera el tope de tokens activos por usuario.
		const res = await app.request("/api/v1/tokens", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Token 11" }),
		});
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error).toContain("número máximo de tokens activos (10)");
	});

	test("dos creaciones concurrentes en el límite no pueden crear el token 11", async () => {
		const userId = `cap-race-${crypto.randomUUID()}`;
		const raceApp = createTokenApp({
			id: userId,
			role: "author",
			email: `${userId}@example.com`,
			name: "Cap Race",
		});

		for (let i = 0; i < 9; i++) {
			const res = await raceApp.request("/api/v1/tokens", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: `Existing ${i + 1}` }),
			});
			expect(res.status).toBe(201);
		}

		const responses = await Promise.all(
			["Concurrent A", "Concurrent B"].map((name) =>
				raceApp.request("/api/v1/tokens", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name }),
				}),
			),
		);

		expect(responses.map((response) => response.status).sort()).toEqual([
			201, 403,
		]);

		const listResponse = await raceApp.request("/api/v1/tokens");
		const listBody = await listResponse.json();
		expect(listBody.data).toHaveLength(10);
	});
});
