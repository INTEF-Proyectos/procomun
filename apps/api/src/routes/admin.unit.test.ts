import { describe, expect, test } from "bun:test";
import * as repo from "@procomun/db/repository";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { getDb } from "../db.ts";
import { adminRoutes } from "./admin/index.ts";

function createAdminApp(mockUser: Record<string, unknown> | null = null) {
	const app = new Hono<AuthEnv>();
	app.use("*", async (c, next) => {
		c.set("user", mockUser as AuthEnv["Variables"]["user"]);
		c.set(
			"session",
			mockUser ? ({ id: "s" } as AuthEnv["Variables"]["session"]) : null,
		);
		await next();
	});
	app.route("/api/admin", adminRoutes);
	return app;
}

const validResource = {
	title: "Test Resource",
	description: "Test description for resource",
	language: "es",
	license: "cc-by",
	resourceType: "documento",
	author: "Autora de prueba",
};

describe("Rutas admin — con sesión de admin", () => {
	const app = createAdminApp({ id: "1", role: "admin" });

	test("POST /api/admin/resources → 201 con body válido", async () => {
		const res = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validResource),
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.id).toBeDefined();
		expect(body.slug).toBeDefined();
	});

	test("POST /api/admin/resources → 400 sin campos obligatorios", async () => {
		const res = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "Solo título" }),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.details).toBeDefined();
		expect(Array.isArray(body.details)).toBe(true);
		expect(body.details.length).toBeGreaterThan(0);
		expect(body.details[0].field).toBeDefined();
		expect(body.details[0].message).toBeDefined();
	});

	test("GET /api/admin/resources → 200 con lista", async () => {
		const res = await app.request("/api/admin/resources");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body.data)).toBe(true);
		expect(typeof body.total).toBe("number");
		expect(body.total).toBeGreaterThan(0);
	});

	test("GET /api/admin/resources?status=published → total numérico", async () => {
		const res = await app.request(
			"/api/admin/resources?limit=1&status=published",
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(typeof body.total).toBe("number");
		expect(Number.isFinite(body.total)).toBe(true);
	});

	test("GET /api/admin/resources/:id → 200 con recurso existente", async () => {
		const createRes = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validResource),
		});
		const created = await createRes.json();

		const res = await app.request(`/api/admin/resources/${created.id}`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.id).toBe(created.id);
		expect(body.title).toBe(validResource.title);
	});

	test("GET /api/admin/resources/:id/elpx → 200 con metadata JSONB", async () => {
		const createRes = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ...validResource, title: "Recurso con ELPX" }),
		});
		const created = await createRes.json();

		await repo.createElpxProject(getDb().db, {
			resourceId: created.id,
			hash: `hash-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
			extractPath: "/tmp/elpx-test",
			originalFilename: "actividad.elpx",
			hasPreview: true,
			elpxMetadata: {
				title: "Título ELPX",
				description: "Descripción ELPX",
				author: "Autor ELPX",
				language: "es",
				license: "cc-by",
			},
		});

		const res = await app.request(`/api/admin/resources/${created.id}/elpx`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.hash).toContain("hash-");
		expect(body.previewUrl).toContain("/api/v1/elpx/");
		expect(body.originalFilename).toBe("actividad.elpx");
		expect(body.metadata).toEqual({
			title: "Título ELPX",
			description: "Descripción ELPX",
			author: "Autor ELPX",
			language: "es",
			license: "cc-by",
		});
	});

	test("GET /api/admin/resources/:id → 404 para id inexistente", async () => {
		const res = await app.request("/api/admin/resources/no-existe-xyz");
		expect(res.status).toBe(404);
	});

	test("PATCH /api/admin/resources/:id → 200", async () => {
		const createRes = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validResource),
		});
		const created = await createRes.json();

		const res = await app.request(`/api/admin/resources/${created.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "Título actualizado" }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.updated).toBe(true);
	});

	test("PATCH /api/admin/resources/:id → 404 para id inexistente", async () => {
		const res = await app.request("/api/admin/resources/no-existe", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "Nuevo" }),
		});
		expect(res.status).toBe(404);
	});

	test("PATCH /api/admin/resources/:id → 400 sin campos", async () => {
		const createRes = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validResource),
		});
		const created = await createRes.json();

		const res = await app.request(`/api/admin/resources/${created.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	test("DELETE /api/admin/resources/:id → 200 soft delete", async () => {
		const createRes = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ...validResource, title: "Para borrar" }),
		});
		const created = await createRes.json();

		const res = await app.request(`/api/admin/resources/${created.id}`, {
			method: "DELETE",
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.deleted).toBe(true);

		// Recurso ya no aparece por GET
		const getRes = await app.request(`/api/admin/resources/${created.id}`);
		expect(getRes.status).toBe(404);
	});

	test("PATCH /api/admin/resources/:id/status → 200 transición válida (draft→review→published)", async () => {
		const createRes = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validResource),
		});
		const created = await createRes.json();

		// draft → review
		const r1 = await app.request(`/api/admin/resources/${created.id}/status`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: "review" }),
		});
		expect(r1.status).toBe(200);

		// review → published
		const r2 = await app.request(`/api/admin/resources/${created.id}/status`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: "published" }),
		});
		expect(r2.status).toBe(200);
		const body = await r2.json();
		expect(body.status).toBe("published");
	});

	test("PATCH /api/admin/resources/:id/status → 200 transición directa (draft→published) para admin/editor+", async () => {
		const createRes = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validResource),
		});
		const created = await createRes.json();

		const res = await app.request(`/api/admin/resources/${created.id}/status`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: "published" }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.status).toBe("published");
	});

	test("PATCH /api/admin/resources/:id/status → 404 recurso inexistente", async () => {
		const res = await app.request("/api/admin/resources/no-existe-xyz/status", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: "review" }),
		});
		expect(res.status).toBe(404);
	});

	test("PATCH /api/admin/resources/:id/status → 400 sin status", async () => {
		const res = await app.request("/api/admin/resources/res-2/status", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	test("PATCH /api/admin/resources/:id/status → 400 con status inválido", async () => {
		const res = await app.request("/api/admin/resources/res-2/status", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: "borrador" }),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.details).toBeDefined();
	});

	test("GET /api/admin/users → 200", async () => {
		const res = await app.request("/api/admin/users");
		expect(res.status).toBe(200);
	});

	test("POST /api/admin/collections → 201 y GET /api/admin/collections → lista", async () => {
		const createRes = await app.request("/api/admin/collections", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Colección demo",
				description: "Descripción de colección",
			}),
		});
		expect(createRes.status).toBe(201);

		const listRes = await app.request("/api/admin/collections");
		expect(listRes.status).toBe(200);
		const body = await listRes.json();
		expect(body.total).toBeGreaterThan(0);
	});

	test("POST /api/admin/taxonomies → 201 y GET /api/admin/taxonomies → lista", async () => {
		const createRes = await app.request("/api/admin/taxonomies", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Matemáticas", type: "subject" }),
		});
		expect(createRes.status).toBe(201);

		const listRes = await app.request("/api/admin/taxonomies");
		expect(listRes.status).toBe(200);
		const body = await listRes.json();
		expect(body.total).toBeGreaterThan(0);
	});

	test("GET/PUT /api/admin/settings permiten leer y actualizar configuración", async () => {
		const updateRes = await app.request("/api/admin/settings", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				badge_novedad_days: "15",
				badge_destacado_min_ratings: "5",
			}),
		});
		expect(updateRes.status).toBe(200);

		const getRes = await app.request("/api/admin/settings");
		expect(getRes.status).toBe(200);
		const body = await getRes.json();
		expect(body.badge_novedad_days).toBe("15");
		expect(body.badge_destacado_min_ratings).toBe("5");
	});
});

describe("Rutas admin — flujo editorial visible para curator", () => {
	const curatorApp = createAdminApp({ id: "curator-review", role: "curator" });
	const adminApp = createAdminApp({ id: "admin-review", role: "admin" });

	test("curator lista todos los recursos pero solo puede gestionar los que estan en review", async () => {
		await repo.ensureUser(getDb().db, {
			id: "curator-review",
			email: "curator-review@local.invalid",
			name: "Curator Review",
			role: "curator",
		});
		await repo.ensureUser(getDb().db, {
			id: "admin-review",
			email: "admin-review@local.invalid",
			name: "Admin Review",
			role: "admin",
		});

		const reviewCreateRes = await adminApp.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				...validResource,
				title: `Pendiente revision ${crypto.randomUUID()}`,
			}),
		});
		expect(reviewCreateRes.status).toBe(201);
		const reviewCreated = (await reviewCreateRes.json()) as { id: string };

		const draftCreateRes = await adminApp.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				...validResource,
				title: `Borrador visible ${crypto.randomUUID()}`,
			}),
		});
		expect(draftCreateRes.status).toBe(201);
		const draftCreated = (await draftCreateRes.json()) as { id: string };

		const reviewRes = await adminApp.request(
			`/api/admin/resources/${reviewCreated.id}/status`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "review" }),
			},
		);
		expect(reviewRes.status).toBe(200);

		const listAllRes = await curatorApp.request("/api/admin/resources");
		expect(listAllRes.status).toBe(200);
		const listAllBody = (await listAllRes.json()) as {
			total: number;
			data: Array<{ id: string }>;
		};
		expect(listAllBody.total).toBeGreaterThanOrEqual(2);
		expect(
			listAllBody.data.some((resource) => resource.id === reviewCreated.id),
		).toBe(true);
		expect(
			listAllBody.data.some((resource) => resource.id === draftCreated.id),
		).toBe(true);

		const listRes = await curatorApp.request(
			"/api/admin/resources?status=review",
		);
		expect(listRes.status).toBe(200);
		const listBody = (await listRes.json()) as {
			total: number;
			data: Array<{ id: string }>;
		};
		expect(listBody.total).toBeGreaterThan(0);
		expect(
			listBody.data.some((resource) => resource.id === reviewCreated.id),
		).toBe(true);

		const getRes = await curatorApp.request(
			`/api/admin/resources/${reviewCreated.id}`,
		);
		expect(getRes.status).toBe(200);

		const draftGetRes = await curatorApp.request(
			`/api/admin/resources/${draftCreated.id}`,
		);
		expect(draftGetRes.status).toBe(403);

		const draftPatchRes = await curatorApp.request(
			`/api/admin/resources/${draftCreated.id}`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "No deberia editar" }),
			},
		);
		expect(draftPatchRes.status).toBe(403);

		const publishRes = await curatorApp.request(
			`/api/admin/resources/${reviewCreated.id}/status`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "published" }),
			},
		);
		expect(publishRes.status).toBe(200);
		const publishBody = (await publishRes.json()) as { status: string };
		expect(publishBody.status).toBe("published");
	});

	test("curator sigue accediendo al recurso tras pasarlo de review a draft (DEF-009 / #205)", async () => {
		await repo.ensureUser(getDb().db, {
			id: "curator-review",
			email: "curator-review@local.invalid",
			name: "Curator Review",
			role: "curator",
		});
		await repo.ensureUser(getDb().db, {
			id: "admin-review",
			email: "admin-review@local.invalid",
			name: "Admin Review",
			role: "admin",
		});

		const createRes = await adminApp.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				...validResource,
				title: `DEF-009 draft ${crypto.randomUUID()}`,
			}),
		});
		expect(createRes.status).toBe(201);
		const created = (await createRes.json()) as { id: string };

		// El recurso entra en la cola de revisión.
		const reviewRes = await adminApp.request(
			`/api/admin/resources/${created.id}/status`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "review" }),
			},
		);
		expect(reviewRes.status).toBe(200);

		// El curator lo rechaza devolviéndolo a borrador.
		const draftRes = await curatorApp.request(
			`/api/admin/resources/${created.id}/status`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "draft" }),
			},
		);
		expect(draftRes.status).toBe(200);

		// Regresión DEF-009: el curator que actuó debe seguir viendo el recurso.
		const getRes = await curatorApp.request(
			`/api/admin/resources/${created.id}`,
		);
		expect(getRes.status).toBe(200);
		const body = (await getRes.json()) as {
			id: string;
			editorialStatus: string;
		};
		expect(body.id).toBe(created.id);
		expect(body.editorialStatus).toBe("draft");
	});

	test("curator sigue accediendo al recurso tras publicarlo desde review (DEF-009 / #205)", async () => {
		await repo.ensureUser(getDb().db, {
			id: "curator-review",
			email: "curator-review@local.invalid",
			name: "Curator Review",
			role: "curator",
		});
		await repo.ensureUser(getDb().db, {
			id: "admin-review",
			email: "admin-review@local.invalid",
			name: "Admin Review",
			role: "admin",
		});

		const createRes = await adminApp.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				...validResource,
				title: `DEF-009 pub ${crypto.randomUUID()}`,
			}),
		});
		expect(createRes.status).toBe(201);
		const created = (await createRes.json()) as { id: string };

		await adminApp.request(`/api/admin/resources/${created.id}/status`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: "review" }),
		});

		const publishRes = await curatorApp.request(
			`/api/admin/resources/${created.id}/status`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "published" }),
			},
		);
		expect(publishRes.status).toBe(200);

		// Regresión DEF-009: el curator que publica debe seguir viendo el recurso.
		const getRes = await curatorApp.request(
			`/api/admin/resources/${created.id}`,
		);
		expect(getRes.status).toBe(200);
		const body = (await getRes.json()) as {
			id: string;
			editorialStatus: string;
		};
		expect(body.editorialStatus).toBe("published");
	});
});

describe("Rutas admin — RBAC por rol", () => {
	test("reader no puede acceder a /admin", async () => {
		const app = createAdminApp({ id: "1", role: "reader" });
		const res = await app.request("/api/admin/resources");
		expect(res.status).toBe(403);
	});

	// DEF-221 (#221): author y editor SÍ pueden gestionar recursos (son creadores
	// de contenido), aunque no el resto del backoffice.
	test("author puede acceder a recursos", async () => {
		const app = createAdminApp({ id: "1", role: "author" });
		const res = await app.request("/api/admin/resources");
		expect(res.status).toBe(200);
	});

	test("editor puede acceder a recursos", async () => {
		const app = createAdminApp({ id: "1", role: "editor" });
		const res = await app.request("/api/admin/resources");
		expect(res.status).toBe(200);
	});

	test("curator puede acceder a /admin", async () => {
		const app = createAdminApp({ id: "1", role: "curator" });
		const res = await app.request("/api/admin/resources");
		expect(res.status).toBe(200);
	});

	test("admin puede acceder a /admin", async () => {
		const app = createAdminApp({ id: "1", role: "admin" });
		const res = await app.request("/api/admin/resources");
		expect(res.status).toBe(200);
	});

	test("curator puede aprobar recurso (review→published)", async () => {
		const adminApp = createAdminApp({ id: "admin-rbac", role: "admin" });
		const curatorApp = createAdminApp({ id: "curator-rbac", role: "curator" });
		await repo.ensureUser(getDb().db, {
			id: "admin-rbac",
			email: "admin-rbac@local.invalid",
			name: "Admin Rbac",
			role: "admin",
		});
		await repo.ensureUser(getDb().db, {
			id: "curator-rbac",
			email: "curator-rbac@local.invalid",
			name: "Curator Rbac",
			role: "curator",
		});

		const createRes = await adminApp.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validResource),
		});
		const created = await createRes.json();

		await adminApp.request(`/api/admin/resources/${created.id}/status`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: "review" }),
		});

		// Ahora aprobar como curator
		const res = await curatorApp.request(
			`/api/admin/resources/${created.id}/status`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "published" }),
			},
		);
		expect(res.status).toBe(200);
	});

	test("solo admin puede gestionar usuarios", async () => {
		const app = createAdminApp({ id: "1", role: "curator" });
		const res = await app.request("/api/admin/users");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.total).toBe(1);
	});

	test("curator puede listar taxonomías pero no crearlas", async () => {
		const app = createAdminApp({ id: "1", role: "curator" });
		const listRes = await app.request("/api/admin/taxonomies");
		expect(listRes.status).toBe(200);

		const createRes = await app.request("/api/admin/taxonomies", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Lengua" }),
		});
		expect(createRes.status).toBe(403);
	});

	test("author no puede acceder a colecciones", async () => {
		const authorApp = createAdminApp({
			id: "author-collections",
			role: "author",
		});
		const res = await authorApp.request("/api/admin/collections");
		expect(res.status).toBe(403);
	});
});

describe("Rutas admin — subida de recursos por author/editor/curator (DEF-221)", () => {
	async function setupUser(id: string, role: string) {
		await repo.ensureUser(getDb().db, {
			id,
			email: `${id}@local.invalid`,
			name: `User ${id}`,
			role,
		});
		return createAdminApp({
			id,
			role,
			email: `${id}@local.invalid`,
			name: `User ${id}`,
		});
	}

	test("author puede crear un recurso (no 'Permisos insuficientes')", async () => {
		const app = await setupUser(`author-${crypto.randomUUID()}`, "author");
		const res = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validResource),
		});
		expect(res.status).toBe(201);
	});

	test("author puede crear un borrador", async () => {
		const app = await setupUser(`author-d-${crypto.randomUUID()}`, "author");
		const res = await app.request("/api/admin/resources/draft", {
			method: "POST",
		});
		expect(res.status).toBe(201);
	});

	test("editor puede crear un recurso", async () => {
		const app = await setupUser(`editor-${crypto.randomUUID()}`, "editor");
		const res = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validResource),
		});
		expect(res.status).toBe(201);
	});

	test("el borrador precarga el autor con el nombre del usuario", async () => {
		const userId = `author-n-${crypto.randomUUID()}`;
		const app = await setupUser(userId, "author");
		const res = await app.request("/api/admin/resources/draft", {
			method: "POST",
		});
		const { id } = await res.json();
		const getRes = await app.request(`/api/admin/resources/${id}`);
		expect((await getRes.json()).author).toBe(`User ${userId}`);
	});

	test("curator puede crear un recurso y acceder a su propio borrador (no 'Recurso no encontrado')", async () => {
		const id = `curator-${crypto.randomUUID()}`;
		const app = await setupUser(id, "curator");
		const createRes = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validResource),
		});
		expect(createRes.status).toBe(201);
		const created = await createRes.json();

		// Regresión DEF-221: el creador debe poder ver su propio borrador.
		const getRes = await app.request(`/api/admin/resources/${created.id}`);
		expect(getRes.status).toBe(200);
		const body = await getRes.json();
		expect(body.id).toBe(created.id);
	});

	test("reader NO puede crear recursos", async () => {
		const app = createAdminApp({ id: "reader-x", role: "reader" });
		const res = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validResource),
		});
		expect(res.status).toBe(403);
	});

	test("author NO puede acceder a usuarios ni a settings", async () => {
		const app = await setupUser(`author-deny-${crypto.randomUUID()}`, "author");
		expect((await app.request("/api/admin/users")).status).toBe(403);
		expect((await app.request("/api/admin/settings")).status).toBe(403);
	});

	test("un author que NO es el creador no puede subir/guardar elpx en un recurso ajeno (IDOR)", async () => {
		const ownerApp = await setupUser(
			`elpx-owner-${crypto.randomUUID()}`,
			"author",
		);
		const createRes = await ownerApp.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validResource),
		});
		const { id: resourceId } = await createRes.json();

		const intruderApp = await setupUser(
			`elpx-intruder-${crypto.randomUUID()}`,
			"author",
		);
		expect(
			(
				await intruderApp.request(`/api/admin/elpx/upload/${resourceId}`, {
					method: "POST",
				})
			).status,
		).toBe(403);
		expect(
			(
				await intruderApp.request(`/api/admin/elpx/save/${resourceId}`, {
					method: "POST",
				})
			).status,
		).toBe(403);

		// El creador sí pasa el control de propiedad (no 403; 400 por faltar el fichero).
		const ownerUpload = await ownerApp.request(
			`/api/admin/elpx/upload/${resourceId}`,
			{ method: "POST" },
		);
		expect(ownerUpload.status).not.toBe(403);
	});
});

describe("Rutas admin — uploads/config", () => {
	test("author puede leer la config, no expone storageDir y reader queda bloqueado", async () => {
		const authorApp = createAdminApp({ id: "cfg-author", role: "author" });
		const res = await authorApp.request("/api/admin/uploads/config");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.storageDir).toBeUndefined();
		expect(typeof body.maxFileSizeBytes).toBe("number");

		const readerApp = createAdminApp({ id: "cfg-reader", role: "reader" });
		expect((await readerApp.request("/api/admin/uploads/config")).status).toBe(
			403,
		);
	});
});

describe("Rutas admin — usuarios", () => {
	const app = createAdminApp({
		id: "1",
		role: "admin",
		email: "admin@test.com",
		name: "Admin",
	});

	test("GET /api/admin/users → 200 lista usuarios", async () => {
		const res = await app.request("/api/admin/users");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toBeDefined();
		expect(typeof body.total).toBe("number");
	});

	test("GET /api/admin/users/:id → 200 con usuario propio", async () => {
		const res = await app.request("/api/admin/users/1");
		expect(res.status).toBe(200);
	});

	test("GET /api/admin/users/:id → 404 con id inexistente", async () => {
		const res = await app.request("/api/admin/users/no-existe-xyz");
		expect(res.status).toBe(404);
	});

	test("non-admin (author) no puede acceder a /admin/users", async () => {
		const authorApp = createAdminApp({
			id: "author-u",
			role: "author",
			email: "author-u@test.com",
			name: "Author",
		});
		const res = await authorApp.request("/api/admin/users");
		expect(res.status).toBe(403);
	});

	test("non-admin (author) no puede ver otros usuarios", async () => {
		const authorApp = createAdminApp({ id: "author-u2", role: "author" });
		const res = await authorApp.request("/api/admin/users/1");
		expect(res.status).toBe(403);
	});
});

describe("Rutas admin — colecciones", () => {
	const app = createAdminApp({
		id: "1",
		role: "admin",
		email: "admin@test.com",
		name: "Admin",
	});

	test("GET /api/admin/collections → 200 lista colecciones", async () => {
		const res = await app.request("/api/admin/collections");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toBeDefined();
	});

	test("POST /api/admin/collections → 201 con body válido", async () => {
		const res = await app.request("/api/admin/collections", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Mi colección",
				description: "Descripción de prueba",
				coverImageUrl: "https://example.com/coleccion.jpg",
			}),
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.id).toBeDefined();
	});

	test("POST /api/admin/collections → 400 sin título", async () => {
		const res = await app.request("/api/admin/collections", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ description: "Solo descripción" }),
		});
		expect(res.status).toBe(400);
	});

	test("CRUD completo de colección", async () => {
		const resourceRes = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				...validResource,
				title: "Recurso para colección",
			}),
		});
		expect(resourceRes.status).toBe(201);
		const resource = await resourceRes.json();

		const createRes = await app.request("/api/admin/collections", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Colección CRUD",
				description: "Para test CRUD",
				coverImageUrl: "https://example.com/crud.jpg",
			}),
		});
		expect(createRes.status).toBe(201);
		const { id } = await createRes.json();

		const getRes = await app.request(`/api/admin/collections/${id}`);
		expect(getRes.status).toBe(200);

		const patchRes = await app.request(`/api/admin/collections/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Colección actualizada",
				description: "Desc actualizada",
				coverImageUrl: "https://example.com/actualizada.jpg",
				editorialStatus: "published",
				isOrdered: true,
			}),
		});
		expect(patchRes.status).toBe(200);

		const updatedRes = await app.request(`/api/admin/collections/${id}`);
		expect(updatedRes.status).toBe(200);
		const updated = await updatedRes.json();
		expect(updated.editorialStatus).toBe("published");
		expect(updated.isOrdered).toBe(true);
		expect(updated.coverImageUrl).toBe("https://example.com/actualizada.jpg");

		const addResourceRes = await app.request(
			`/api/admin/collections/${id}/resources`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ resourceId: resource.id }),
			},
		);
		expect(addResourceRes.status).toBe(201);

		const duplicateAddResourceRes = await app.request(
			`/api/admin/collections/${id}/resources`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ resourceId: resource.id }),
			},
		);
		expect(duplicateAddResourceRes.status).toBe(409);

		const listResourcesRes = await app.request(
			`/api/admin/collections/${id}/resources`,
		);
		expect(listResourcesRes.status).toBe(200);
		const collectionResources = await listResourcesRes.json();
		expect(collectionResources).toHaveLength(1);
		expect(collectionResources[0].resourceId).toBe(resource.id);

		const reorderRes = await app.request(
			`/api/admin/collections/${id}/resources/reorder`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ resourceId: resource.id, direction: "up" }),
			},
		);
		expect([200, 400]).toContain(reorderRes.status);

		const removeResourceRes = await app.request(
			`/api/admin/collections/${id}/resources/${resource.id}`,
			{
				method: "DELETE",
			},
		);
		expect(removeResourceRes.status).toBe(200);

		const deleteRes = await app.request(`/api/admin/collections/${id}`, {
			method: "DELETE",
		});
		expect(deleteRes.status).toBe(200);
	});

	test("reader no puede acceder a colecciones", async () => {
		const readerApp = createAdminApp({ id: "r1", role: "reader" });
		const res = await readerApp.request("/api/admin/collections");
		expect(res.status).toBe(403);
	});

	test("curator puede listar y gestionar colecciones existentes", async () => {
		const adminCreateRes = await app.request("/api/admin/collections", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Colección del admin visible al curator",
				description: "Colección creada por admin",
			}),
		});
		expect(adminCreateRes.status).toBe(201);
		const adminCollection = await adminCreateRes.json();

		const curatorApp = createAdminApp({
			id: "curator-1",
			role: "curator",
			email: "curator@test.com",
			name: "Curator",
		});
		const createRes = await curatorApp.request("/api/admin/collections", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Colección curada",
				description: "Descripción curada",
			}),
		});
		expect(createRes.status).toBe(201);

		const listRes = await curatorApp.request("/api/admin/collections");
		expect(listRes.status).toBe(200);
		const listBody = await listRes.json();
		expect(
			listBody.data.some(
				(item: { id: string }) => item.id === adminCollection.id,
			),
		).toBe(true);
		expect(
			listBody.data.some(
				(item: { curatorId: string }) => item.curatorId === "curator-1",
			),
		).toBe(true);

		const patchRes = await curatorApp.request(
			`/api/admin/collections/${adminCollection.id}`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ description: "Actualizada por curator" }),
			},
		);
		expect(patchRes.status).toBe(200);
	});
});

describe("Rutas admin — taxonomías", () => {
	const app = createAdminApp({ id: "1", role: "admin" });

	test("GET /api/admin/taxonomies → 200 lista taxonomías", async () => {
		const res = await app.request("/api/admin/taxonomies");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toBeDefined();
	});

	test("POST /api/admin/taxonomies → 201 con body válido", async () => {
		const res = await app.request("/api/admin/taxonomies", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Lengua Castellana", type: "subject" }),
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.id).toBeDefined();
	});

	test("POST /api/admin/taxonomies → 409 si nombre+tipo duplicado", async () => {
		const res = await app.request("/api/admin/taxonomies", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Lengua Castellana", type: "subject" }),
		});
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error).toContain("Ya existe");
	});

	test("POST /api/admin/taxonomies → 400 sin nombre", async () => {
		const res = await app.request("/api/admin/taxonomies", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ type: "subject" }),
		});
		expect(res.status).toBe(400);
	});

	test("CRUD completo de taxonomía", async () => {
		const createRes = await app.request("/api/admin/taxonomies", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Ciencias", type: "subject" }),
		});
		expect(createRes.status).toBe(201);
		const { id } = await createRes.json();

		const getRes = await app.request(`/api/admin/taxonomies/${id}`);
		expect(getRes.status).toBe(200);

		const patchRes = await app.request(`/api/admin/taxonomies/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Ciencias Naturales" }),
		});
		expect(patchRes.status).toBe(200);

		const deleteRes = await app.request(`/api/admin/taxonomies/${id}`, {
			method: "DELETE",
		});
		expect(deleteRes.status).toBe(200);
	});

	test("author no puede acceder a taxonomías", async () => {
		const authorApp = createAdminApp({ id: "a1", role: "author" });
		const res = await authorApp.request("/api/admin/taxonomies");
		expect(res.status).toBe(403);
	});

	test("solo admin puede acceder a settings", async () => {
		const curatorApp = createAdminApp({ id: "c1", role: "curator" });
		const res = await curatorApp.request("/api/admin/settings");
		expect(res.status).toBe(403);
	});
});

describe("Rutas admin — alta de usuarios (DEF-019)", () => {
	const adminApp = createAdminApp({
		id: "1",
		role: "admin",
		email: "admin@test.com",
		name: "Admin",
	});

	test("POST /api/admin/users → 201 crea el usuario SIN cambiar la sesión activa", async () => {
		const email = `nuevo-${crypto.randomUUID()}@test.com`;
		const res = await adminApp.request("/api/admin/users", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Nuevo", email, password: "supersecret8" }),
		});
		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.id).toBeDefined();
		expect(body.created).toBe(true);

		// Regresión DEF-019: el endpoint NO debe iniciar sesión como el nuevo usuario.
		expect(res.headers.get("set-cookie")).toBeNull();

		// El nuevo usuario aparece en el listado
		const listRes = await adminApp.request(
			`/api/admin/users?q=${encodeURIComponent(email)}`,
		);
		const list = await listRes.json();
		expect(list.data.some((u: { email: string }) => u.email === email)).toBe(
			true,
		);
	});

	test("POST /api/admin/users → 400 con email inválido o contraseña corta", async () => {
		const bad = await adminApp.request("/api/admin/users", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "X",
				email: "no-es-email",
				password: "123",
			}),
		});
		expect(bad.status).toBe(400);
		const body = await bad.json();
		expect(Array.isArray(body.details)).toBe(true);
		expect(body.details.length).toBeGreaterThan(0);
	});

	test("POST /api/admin/users → 409 si el email ya existe", async () => {
		const email = `dup-${crypto.randomUUID()}@test.com`;
		const first = await adminApp.request("/api/admin/users", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Dup", email, password: "supersecret8" }),
		});
		expect(first.status).toBe(201);

		const second = await adminApp.request("/api/admin/users", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Dup2", email, password: "supersecret8" }),
		});
		expect(second.status).toBe(409);
	});

	test("POST /api/admin/users → 403 para roles no administradores", async () => {
		const curatorApp = createAdminApp({ id: "cur-create", role: "curator" });
		const res = await curatorApp.request("/api/admin/users", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "X",
				email: `c-${crypto.randomUUID()}@test.com`,
				password: "supersecret8",
			}),
		});
		expect(res.status).toBe(403);
	});
});

describe("Rutas admin — baja de usuarios (DEF-020)", () => {
	const adminApp = createAdminApp({
		id: "1",
		role: "admin",
		email: "admin@test.com",
		name: "Admin",
	});

	test("DELETE /api/admin/users/:id → 200 y el usuario desaparece del listado", async () => {
		const email = `borrar-${crypto.randomUUID()}@test.com`;
		const createRes = await adminApp.request("/api/admin/users", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "Para borrar",
				email,
				password: "supersecret8",
			}),
		});
		const { id } = await createRes.json();

		const delRes = await adminApp.request(`/api/admin/users/${id}`, {
			method: "DELETE",
		});
		expect(delRes.status).toBe(200);
		const delBody = await delRes.json();
		expect(delBody.deleted).toBe(true);

		// Regresión DEF-020: ya no aparece en el listado
		const listRes = await adminApp.request(
			`/api/admin/users?q=${encodeURIComponent(email)}`,
		);
		const list = await listRes.json();
		expect(list.data.some((u: { id: string }) => u.id === id)).toBe(false);
	});

	test("DELETE /api/admin/users/:id → 404 para id inexistente", async () => {
		const res = await adminApp.request("/api/admin/users/no-existe-xyz", {
			method: "DELETE",
		});
		expect(res.status).toBe(404);
	});

	test("DELETE /api/admin/users/:id → 400 al intentar borrarse a sí mismo", async () => {
		const res = await adminApp.request("/api/admin/users/1", {
			method: "DELETE",
		});
		expect(res.status).toBe(400);
	});

	test("DELETE /api/admin/users/:id → 403 para roles no administradores", async () => {
		const curatorApp = createAdminApp({ id: "cur-del", role: "curator" });
		const res = await curatorApp.request("/api/admin/users/whoever", {
			method: "DELETE",
		});
		expect(res.status).toBe(403);
	});

	test("re-eliminar o editar un usuario ya dado de baja → 404 (idempotente)", async () => {
		const email = `idemp-${crypto.randomUUID()}@test.com`;
		const createRes = await adminApp.request("/api/admin/users", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Idemp", email, password: "supersecret8" }),
		});
		const { id } = await createRes.json();

		const firstDelete = await adminApp.request(`/api/admin/users/${id}`, {
			method: "DELETE",
		});
		expect(firstDelete.status).toBe(200);

		// Segunda baja: ya no existe para la administración → 404 (no vuelve a "borrar")
		const secondDelete = await adminApp.request(`/api/admin/users/${id}`, {
			method: "DELETE",
		});
		expect(secondDelete.status).toBe(404);

		// Tampoco se puede reactivar por PATCH un usuario dado de baja
		const patchRes = await adminApp.request(`/api/admin/users/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ isActive: true }),
		});
		expect(patchRes.status).toBe(404);
	});
});

describe("Rutas admin — usuarios: autoservicio, auditoría y validación", () => {
	test("GET /api/admin/users devuelve ficha sintética propia para curator sin registro en BD", async () => {
		const ghostApp = createAdminApp({
			id: "ghost-self",
			role: "curator",
			email: "ghost@test.com",
			name: "Ghost",
		});
		const res = await ghostApp.request("/api/admin/users");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.total).toBe(1);
		expect(body.data[0].email).toBe("ghost@test.com");
	});

	test("GET /api/admin/users/:id propio devuelve ficha sintética si no existe en BD", async () => {
		const ghostApp = createAdminApp({
			id: "ghost-self-2",
			role: "curator",
			email: "ghost2@test.com",
			name: "Ghost2",
		});
		const res = await ghostApp.request("/api/admin/users/ghost-self-2");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.email).toBe("ghost2@test.com");
	});

	test("GET /api/admin/users/:id ajeno → 403 para no-admin (curator)", async () => {
		const ghostApp = createAdminApp({ id: "ghost-self-3", role: "curator" });
		const res = await ghostApp.request("/api/admin/users/otro-id");
		expect(res.status).toBe(403);
	});

	test("PATCH /api/admin/users/:id con rol registra auditoría y responde 200", async () => {
		const adminApp = createAdminApp({ id: "1", role: "admin" });
		const email = `audit-${crypto.randomUUID()}@test.com`;
		const createRes = await adminApp.request("/api/admin/users", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Audit", email, password: "supersecret8" }),
		});
		const { id } = await createRes.json();

		const res = await adminApp.request(`/api/admin/users/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ role: "editor", isActive: false }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.updated).toBe(true);
	});

	test("POST /api/admin/users → 400 con cuerpo no JSON", async () => {
		const adminApp = createAdminApp({ id: "1", role: "admin" });
		const res = await adminApp.request("/api/admin/users", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "esto no es json",
		});
		expect(res.status).toBe(400);
	});
});

describe("Rutas admin — actualización de usuarios", () => {
	test("PATCH /api/admin/users/:id → 200 actualiza usuario", async () => {
		const adminApp = createAdminApp({ id: "1", role: "admin" });
		const usersRes = await adminApp.request("/api/admin/users");
		const users = await usersRes.json();
		if (users.data.length > 0) {
			const userId = users.data[0].id;
			const res = await adminApp.request(`/api/admin/users/${userId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "Updated Name" }),
			});
			expect(res.status).toBe(200);
		}
	});

	test("PATCH /api/admin/users/:id → autoservicio persiste nombre y bio (DEF-004 / #201)", async () => {
		// El backoffice de usuarios exige curator+ (DEF-021); un curator editando su
		// propio perfil reproduce el caso real del defecto (el nombre se guardaba, la bio no).
		const id = `self-bio-${crypto.randomUUID()}`;
		const email = `${id}@test.com`;
		await repo.ensureUser(getDb().db, {
			id,
			email,
			name: "Self Bio",
			role: "curator",
		});
		const selfApp = createAdminApp({
			id,
			role: "curator",
			email,
			name: "Self Bio",
		});

		const patchRes = await selfApp.request(`/api/admin/users/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "Self Bio Editado",
				bio: "Mi biografía actualizada",
			}),
		});
		expect(patchRes.status).toBe(200);

		// Regresión DEF-004: al volver al perfil, la bio debe seguir persistida.
		const getRes = await selfApp.request(`/api/admin/users/${id}`);
		expect(getRes.status).toBe(200);
		const body = await getRes.json();
		expect(body.name).toBe("Self Bio Editado");
		expect(body.bio).toBe("Mi biografía actualizada");
	});

	test("PATCH /api/admin/users/:id → admin puede vaciar la bio (DEF-004 / #201)", async () => {
		const adminApp = createAdminApp({ id: "1", role: "admin" });
		const email = `bio-clear-${crypto.randomUUID()}@test.com`;
		const createRes = await adminApp.request("/api/admin/users", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "Con Bio",
				email,
				password: "supersecret8",
			}),
		});
		const { id } = await createRes.json();

		await adminApp.request(`/api/admin/users/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ bio: "Texto inicial" }),
		});
		await adminApp.request(`/api/admin/users/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ bio: "" }),
		});

		const getRes = await adminApp.request(`/api/admin/users/${id}`);
		const body = await getRes.json();
		expect(body.bio).toBe("");
	});
});

describe("Rutas admin FTS — con sesión de admin", () => {
	const app = createAdminApp({ id: "1", role: "admin" });

	test("POST /api/admin/fts/reindex/:id → 200 con recurso existente", async () => {
		// Create a resource first
		const createRes = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "FTS reindex test",
				description: "Testing FTS reindex",
				language: "es",
				license: "cc-by",
				resourceType: "documento",
				author: "Autora de prueba",
			}),
		});
		const { id } = await createRes.json();

		const res = await app.request(`/api/admin/fts/reindex/${id}`, {
			method: "POST",
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.reindexed).toBe(true);
		expect(body.id).toBe(id);
	});

	test("POST /api/admin/fts/re-extract/:id → 200 con recurso existente", async () => {
		const createRes = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "FTS re-extract test",
				description: "Testing FTS re-extraction",
				language: "es",
				license: "cc-by",
				resourceType: "documento",
				author: "Autora de prueba",
			}),
		});
		const { id } = await createRes.json();

		const res = await app.request(`/api/admin/fts/re-extract/${id}`, {
			method: "POST",
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.reExtracted).toBe(true);
		expect(body.id).toBe(id);
	});

	test("POST /api/admin/fts/reindex-all → 200", async () => {
		const res = await app.request("/api/admin/fts/reindex-all", {
			method: "POST",
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.reindexed).toBeGreaterThanOrEqual(0);
	});
});

// Regresión de seguridad: el CRUD genérico de recursos pasaba el cuerpo crudo a
// la capa de datos (.set({ ...data })), de modo que un author (rol por defecto al
// registrarse) podía mass-assign editorialStatus/createdBy/assignedCuratorId/…
// y autopublicarse saltándose el flujo editorial (validateTransition). El alta y
// la edición deben ignorar esas columnas sensibles; el estado solo cambia por
// PATCH /:id/status.
describe("Seguridad — mass assignment / bypass del flujo editorial (recursos)", () => {
	const validResourceSec = {
		title: "Recurso seguridad",
		description: "Descripción para test de seguridad",
		language: "es",
		license: "cc-by",
		resourceType: "documento",
		author: "Autora de prueba",
	};

	test("POST /api/admin/resources ignora editorialStatus/featuredAt del cuerpo (un author no autopublica)", async () => {
		const app = createAdminApp({
			id: `sec-create-${crypto.randomUUID()}`,
			role: "author",
		});
		const res = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				...validResourceSec,
				editorialStatus: "published",
				featuredAt: "2030-01-01T00:00:00.000Z",
			}),
		});
		expect(res.status).toBe(201);
		const created = await res.json();

		const getRes = await app.request(`/api/admin/resources/${created.id}`);
		expect(getRes.status).toBe(200);
		const body = await getRes.json();
		// El recurso nace como borrador pese a pedir "published" en el cuerpo.
		expect(body.editorialStatus).toBe("draft");
		// featuredAt del cuerpo también se ignora (no se destaca vía mass assignment).
		expect(body.featuredAt ?? null).toBeNull();
	});

	test("PATCH /api/admin/resources/:id ignora editorialStatus (no se salta validateTransition)", async () => {
		const authorId = `sec-patch-${crypto.randomUUID()}`;
		const app = createAdminApp({ id: authorId, role: "author" });
		const createRes = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validResourceSec),
		});
		const created = await createRes.json();

		const patchRes = await app.request(`/api/admin/resources/${created.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Título legítimo",
				editorialStatus: "published",
			}),
		});
		expect(patchRes.status).toBe(200);

		const getRes = await app.request(`/api/admin/resources/${created.id}`);
		const body = await getRes.json();
		// El campo descriptivo legítimo sí se actualiza…
		expect(body.title).toBe("Título legítimo");
		// …pero el estado editorial NO cambia por esta vía.
		expect(body.editorialStatus).toBe("draft");
	});

	test("PATCH /api/admin/resources/:id ignora createdBy y assignedCuratorId (sin reasignar propiedad/curación)", async () => {
		const authorId = `sec-owner-${crypto.randomUUID()}`;
		const app = createAdminApp({ id: authorId, role: "author" });
		const createRes = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validResourceSec),
		});
		const created = await createRes.json();

		const patchRes = await app.request(`/api/admin/resources/${created.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				description: "Descripción nueva",
				createdBy: "otro-usuario",
				assignedCuratorId: "otro-usuario",
			}),
		});
		expect(patchRes.status).toBe(200);

		const getRes = await app.request(`/api/admin/resources/${created.id}`);
		const body = await getRes.json();
		expect(body.createdBy).toBe(authorId);
		expect(body.assignedCuratorId).toBeNull();
	});

	test("regresión: la transición legítima sigue funcionando vía PATCH /:id/status", async () => {
		const app = createAdminApp({ id: "1", role: "admin" });
		const createRes = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(validResourceSec),
		});
		const created = await createRes.json();

		const res = await app.request(`/api/admin/resources/${created.id}/status`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: "published" }),
		});
		expect(res.status).toBe(200);

		const getRes = await app.request(`/api/admin/resources/${created.id}`);
		const body = await getRes.json();
		expect(body.editorialStatus).toBe("published");
	});
});
