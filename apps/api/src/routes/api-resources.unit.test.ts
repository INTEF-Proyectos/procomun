import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { apiResourceRoutes } from "./api-resources.ts";

/**
 * Creates a test app with token auth mocked (bypasses actual token validation).
 * If mockUser is null, the middleware returns 401.
 */
function createApiApp(mockUser: Record<string, unknown> | null = null) {
	const app = new Hono<AuthEnv>();

	// Mock the token auth middleware
	app.use("*", async (c, next) => {
		if (!mockUser) {
			return c.json({ error: "Token de autenticación requerido" }, 401);
		}
		c.set("user", mockUser as AuthEnv["Variables"]["user"]);
		c.set("session", null);
		await next();
	});

	app.route("/api/v1/publish/resources", apiResourceRoutes);
	return app;
}

const validResource = {
	title: "Recurso de prueba API",
	description: "Descripción del recurso creado vía API",
	language: "es",
	license: "cc-by",
	resourceType: "documento",
};

describe("API Resources — sin autenticación", () => {
	const app = createApiApp(null);

	test("POST /api/v1/publish/resources → 401 sin token", async () => {
		const res = await app.request("/api/v1/publish/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validResource),
		});
		expect(res.status).toBe(401);
	});

	test("GET /api/v1/publish/resources/some-id → 401 sin token", async () => {
		const res = await app.request("/api/v1/publish/resources/some-id");
		expect(res.status).toBe(401);
	});
});

describe("API Resources — con autenticación", () => {
	const app = createApiApp({
		id: "user-1",
		role: "author",
		email: "test@example.com",
		name: "Test",
	});

	test("POST /api/v1/publish/resources → 201 con body válido", async () => {
		const res = await app.request("/api/v1/publish/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validResource),
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.id).toBeDefined();
		expect(body.slug).toBeDefined();
		expect(body.editorialStatus).toBe("draft");
	});

	test("POST /api/v1/publish/resources → 201 con editorialStatus review", async () => {
		const res = await app.request("/api/v1/publish/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ...validResource, editorialStatus: "review" }),
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.editorialStatus).toBe("review");
	});

	test("POST /api/v1/publish/resources → 400 sin campos obligatorios", async () => {
		const res = await app.request("/api/v1/publish/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "Solo título" }),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.details).toBeDefined();
		expect(Array.isArray(body.details)).toBe(true);
		expect(body.details.length).toBeGreaterThan(0);
	});

	test("POST /api/v1/publish/resources conserva el author enviado", async () => {
		const createRes = await app.request("/api/v1/publish/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ...validResource, author: "Autora del recurso" }),
		});
		expect(createRes.status).toBe(201);
		const { id } = await createRes.json();
		const getRes = await app.request(`/api/v1/publish/resources/${id}`);
		expect((await getRes.json()).author).toBe("Autora del recurso");
	});

	test("POST /api/v1/publish/resources conserva otherAuthors (issue #417)", async () => {
		const createRes = await app.request("/api/v1/publish/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				...validResource,
				otherAuthors: "Luis Gómez, Marta Ruiz",
			}),
		});
		expect(createRes.status).toBe(201);
		const { id } = await createRes.json();
		const getRes = await app.request(`/api/v1/publish/resources/${id}`);
		expect((await getRes.json()).otherAuthors).toBe("Luis Gómez, Marta Ruiz");
	});

	test("POST /api/v1/publish/resources → 400 sin JSON", async () => {
		const res = await app.request("/api/v1/publish/resources", {
			method: "POST",
			headers: { "Content-Type": "text/plain" },
			body: "not json",
		});
		expect(res.status).toBe(400);
	});

	test("GET /api/v1/publish/resources/:id → 404 si no existe", async () => {
		const res = await app.request("/api/v1/publish/resources/non-existent-id");
		expect(res.status).toBe(404);
	});

	test("Full CRUD flow: create, get, update, delete", async () => {
		// Create
		const createRes = await app.request("/api/v1/publish/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validResource),
		});
		expect(createRes.status).toBe(201);
		const { id } = await createRes.json();

		// Get
		const getRes = await app.request(`/api/v1/publish/resources/${id}`);
		expect(getRes.status).toBe(200);
		const resource = await getRes.json();
		expect(resource.title).toBe(validResource.title);
		expect(resource.editorialStatus).toBe("draft");
		// Sin author en el cuerpo firma el dueño del token (ADR-0024).
		expect(resource.author).toBe("Test");

		// Update
		const updateRes = await app.request(`/api/v1/publish/resources/${id}`, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "Título actualizado" }),
		});
		expect(updateRes.status).toBe(200);
		const updateBody = await updateRes.json();
		expect(updateBody.updated).toBe(true);

		// Delete
		const deleteRes = await app.request(`/api/v1/publish/resources/${id}`, {
			method: "DELETE",
		});
		expect(deleteRes.status).toBe(200);
		const deleteBody = await deleteRes.json();
		expect(deleteBody.deleted).toBe(true);

		// Verify deleted
		const getDeleted = await app.request(`/api/v1/publish/resources/${id}`);
		expect(getDeleted.status).toBe(404);
	});
});

describe("API Resources — permisos", () => {
	test("PUT → 404 si recurso no pertenece al usuario", async () => {
		// Create resource as user-1
		const appUser1 = createApiApp({
			id: "user-1",
			role: "author",
			email: "u1@test.com",
			name: "U1",
		});
		const createRes = await appUser1.request("/api/v1/publish/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validResource),
		});
		const { id } = await createRes.json();

		// Try to update as user-2
		const appUser2 = createApiApp({
			id: "user-2",
			role: "author",
			email: "u2@test.com",
			name: "U2",
		});
		const updateRes = await appUser2.request(
			`/api/v1/publish/resources/${id}`,
			{
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "Hack attempt" }),
			},
		);
		expect(updateRes.status).toBe(403);
	});

	test("curator no puede leer, modificar ni eliminar un borrador ajeno", async () => {
		const ownerId = `owner-${crypto.randomUUID()}`;
		const ownerApp = createApiApp({
			id: ownerId,
			role: "author",
			email: `${ownerId}@test.com`,
			name: "Owner",
		});
		const createRes = await ownerApp.request("/api/v1/publish/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validResource),
		});
		const { id } = (await createRes.json()) as { id: string };
		const curatorApp = createApiApp({
			id: `curator-${crypto.randomUUID()}`,
			role: "curator",
			email: "curator@test.com",
			name: "Curator",
		});

		expect(
			(await curatorApp.request(`/api/v1/publish/resources/${id}`)).status,
		).toBe(404);
		expect(
			(
				await curatorApp.request(`/api/v1/publish/resources/${id}`, {
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ title: "Intento de cambio" }),
				})
			).status,
		).toBe(403);
		expect(
			(
				await curatorApp.request(`/api/v1/publish/resources/${id}`, {
					method: "DELETE",
				})
			).status,
		).toBe(403);
	});
});

// #537: la interfaz no deja a un reader crear recursos (NuevoPage lo bloquea),
// pero esta API solo comprobaba que hubiera usuario. Una clave de API de una
// cuenta reader creaba recursos en borrador o en revisión.
describe("API Resources — rol mínimo (#537)", () => {
	test("POST /api/v1/publish/resources → 403 con rol reader", async () => {
		const app = createApiApp({
			id: "reader-537",
			role: "reader",
			email: "reader537@example.com",
			name: "Lectora",
		});
		const res = await app.request("/api/v1/publish/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validResource),
		});
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error).toContain("Permisos insuficientes");
	});

	test("POST /api/v1/publish/resources → 403 con rol reader también en revisión", async () => {
		const app = createApiApp({
			id: "reader-537-review",
			role: "reader",
			email: "reader537r@example.com",
			name: "Lectora",
		});
		const res = await app.request("/api/v1/publish/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				...validResource,
				editorialStatus: "review",
			}),
		});
		expect(res.status).toBe(403);
	});

	test("POST /api/v1/publish/resources → 201 desde author en adelante", async () => {
		for (const role of ["author", "editor", "curator", "admin"]) {
			const app = createApiApp({
				id: `user-537-${role}`,
				role,
				email: `${role}537@example.com`,
				name: role,
			});
			const res = await app.request("/api/v1/publish/resources", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					...validResource,
					title: `Recurso de ${role} (#537)`,
				}),
			});
			expect(res.status).toBe(201);
		}
	});

	test("un usuario sin rol se trata como reader", async () => {
		const app = createApiApp({
			id: "sin-rol-537",
			email: "sinrol537@example.com",
			name: "Sin rol",
		});
		const res = await app.request("/api/v1/publish/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validResource),
		});
		expect(res.status).toBe(403);
	});
});
