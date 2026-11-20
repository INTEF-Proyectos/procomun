import { describe, expect, spyOn, test } from "bun:test";
import * as repo from "@procomun/db/repository";
import { resources as resourcesTable } from "@procomun/db/schema";
import { Hono } from "hono";
import { auth } from "../auth/config.ts";
import type { AuthEnv } from "../auth/middleware.ts";
import { getDb } from "../db.ts";
import { adminRoutes } from "./admin/index.ts";
import { publicRoutes } from "./public.ts";

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
	// #448: hace falta un área para enviar a revisión o publicar.
	knowledgeAreaIds: ["matematicas"],
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

	test("POST /api/admin/resources rechaza Bachillerato con Básico y guarda una clasificación válida", async () => {
		const invalid = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				...validResource,
				educationalAreas: [{ categoryId: "bachillerato", optionId: "basico" }],
			}),
		});
		expect(invalid.status).toBe(400);

		const createdRes = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				...validResource,
				title: "Recurso con categorización",
				educationalAreas: [
					{ categoryId: "educacion-primaria", optionId: "primer-ciclo" },
					{ categoryId: "educacion-primaria", optionId: "segundo-ciclo" },
					{ categoryId: "bachillerato", optionId: null },
				],
			}),
		});
		expect(createdRes.status).toBe(201);
		const created = await createdRes.json();
		const got = await app.request(`/api/admin/resources/${created.id}`);
		const body = await got.json();
		expect(body.educationalAreas).toEqual([
			{ categoryId: "educacion-primaria", optionId: "primer-ciclo" },
			{ categoryId: "educacion-primaria", optionId: "segundo-ciclo" },
			{ categoryId: "bachillerato", optionId: null },
		]);

		const updated = await app.request(`/api/admin/resources/${created.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				educationalAreas: [{ categoryId: "bachillerato", optionId: null }],
			}),
		});
		expect(updated.status).toBe(200);
		const after = await (
			await app.request(`/api/admin/resources/${created.id}`)
		).json();
		expect(after.educationalAreas).toEqual([
			{ categoryId: "bachillerato", optionId: null },
		]);
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

	test("PATCH /:id/status → 400 con los campos que faltan al enviar a revisión un borrador incompleto (#408)", async () => {
		const draftRes = await app.request("/api/admin/resources/draft", {
			method: "POST",
		});
		expect(draftRes.status).toBe(201);
		const draft = await draftRes.json();

		for (const status of ["review", "published"]) {
			const res = await app.request(`/api/admin/resources/${draft.id}/status`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status }),
			});
			expect(res.status).toBe(400);
			const body = await res.json();
			const fields = body.details.map((d: { field: string }) => d.field);
			expect(fields).toContain("description");
			expect(fields).toContain("author");
		}

		const got = await app.request(`/api/admin/resources/${draft.id}`);
		expect((await got.json()).editorialStatus).toBe("draft");
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

	test("curator lista los recursos ajenos salvo los borradores y solo gestiona los que estan en review", async () => {
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
		// #460: el borrador ajeno, sin enviar a revisión, es privado de su autor.
		expect(
			listAllBody.data.some((resource) => resource.id === draftCreated.id),
		).toBe(false);

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

	test("curator pierde el acceso al recurso tras devolverlo de review a draft (#460)", async () => {
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

		// #460: de vuelta en borrador, el recurso es privado de su autor. Antes
		// (DEF-009) el curator que lo devolvía conservaba el acceso.
		const getRes = await curatorApp.request(
			`/api/admin/resources/${created.id}`,
		);
		expect(getRes.status).toBe(403);
		const adminGet = await adminApp.request(
			`/api/admin/resources/${created.id}`,
		);
		expect(adminGet.status).toBe(200);
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

describe("Rutas admin — borradores privados frente al curator (#460)", () => {
	const authorId = "author-460";
	const curatorId = "curator-460";
	const otherCuratorId = "curator-460-b";
	const adminId = "admin-460";
	const authorApp = createAdminApp({ id: authorId, role: "author" });
	const curatorApp = createAdminApp({ id: curatorId, role: "curator" });
	const otherCuratorApp = createAdminApp({
		id: otherCuratorId,
		role: "curator",
	});
	const adminApp = createAdminApp({ id: adminId, role: "admin" });

	async function ensureUsers() {
		for (const [id, role] of [
			[authorId, "author"],
			[curatorId, "curator"],
			[otherCuratorId, "curator"],
			[adminId, "admin"],
		] as const) {
			await repo.ensureUser(getDb().db, {
				id,
				email: `${id}@local.invalid`,
				name: id,
				role,
			});
		}
	}

	async function createDraft(app: ReturnType<typeof createAdminApp>) {
		const title = `Borrador 460 ${crypto.randomUUID()}`;
		const res = await app.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ ...validResource, title }),
		});
		expect(res.status).toBe(201);
		const { id } = (await res.json()) as { id: string };
		return { id, title };
	}

	async function listIds(
		app: ReturnType<typeof createAdminApp>,
		query = "",
	): Promise<{ ids: string[]; total: number }> {
		const res = await app.request(`/api/admin/resources?limit=100${query}`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			total: number;
			data: Array<{ id: string }>;
		};
		return { ids: body.data.map((r) => r.id), total: body.total };
	}

	async function setStatus(
		app: ReturnType<typeof createAdminApp>,
		id: string,
		status: string,
	) {
		return app.request(`/api/admin/resources/${id}/status`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status }),
		});
	}

	test("el curator no ve el borrador ajeno en listados, búsquedas ni contadores", async () => {
		await ensureUsers();
		const draft = await createDraft(authorApp);

		const { total: draftsBefore } = await listIds(curatorApp, "&status=draft");
		expect((await listIds(curatorApp)).ids).not.toContain(draft.id);
		const drafts = await listIds(curatorApp, "&status=draft");
		expect(drafts.ids).not.toContain(draft.id);
		// El contador (total) del panel no cambia por un borrador ajeno.
		await createDraft(authorApp);
		expect((await listIds(curatorApp, "&status=draft")).total).toBe(
			draftsBefore,
		);
		const search = await listIds(
			curatorApp,
			`&q=${encodeURIComponent(draft.title)}`,
		);
		expect(search.ids).not.toContain(draft.id);
		// La misma búsqueda lo encuentra para el admin.
		expect(
			(await listIds(adminApp, `&q=${encodeURIComponent(draft.title)}`)).ids,
		).toContain(draft.id);

		// El autor y el admin sí lo ven.
		expect((await listIds(authorApp, "&status=draft")).ids).toContain(draft.id);
		expect((await listIds(adminApp, "&status=draft")).ids).toContain(draft.id);
	});

	test("el autor encuentra su recurso buscando un término que solo está en la autoría (#580)", async () => {
		await ensureUsers();
		const token = `autoria${crypto.randomUUID().slice(0, 8)}`;
		const res = await authorApp.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				...validResource,
				title: `Sin coincidencia ${crypto.randomUUID()}`,
				author: `Autoría ${token}`,
			}),
		});
		expect(res.status).toBe(201);
		const { id } = (await res.json()) as { id: string };

		expect((await listIds(authorApp, `&q=${token}`)).ids).toContain(id);
	});

	test("el curator no lee ni modifica el borrador ajeno por acceso directo", async () => {
		await ensureUsers();
		const draft = await createDraft(authorApp);
		const base = `/api/admin/resources/${draft.id}`;

		for (const path of [
			base,
			`${base}/versions`,
			`${base}/elpx`,
			`${base}/media`,
			`${base}/uploads`,
		]) {
			const res = await curatorApp.request(path);
			expect([403, 404]).toContain(res.status);
		}

		const patch = await curatorApp.request(base, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title: "No debería editar" }),
		});
		expect(patch.status).toBe(403);
		expect((await setStatus(curatorApp, draft.id, "review")).status).toBe(403);
		const del = await curatorApp.request(base, { method: "DELETE" });
		expect(del.status).toBe(403);

		// Sigue intacto: el autor lo lee con su título.
		const authorGet = await authorApp.request(base);
		expect(authorGet.status).toBe(200);
		expect(((await authorGet.json()) as { title: string }).title).toBe(
			draft.title,
		);
		expect((await adminApp.request(base)).status).toBe(200);
	});

	test("el curator no añade un borrador ajeno a una colección", async () => {
		await ensureUsers();
		const draft = await createDraft(authorApp);
		const colRes = await curatorApp.request("/api/admin/collections", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: `Colección 460 ${crypto.randomUUID()}`,
				description: "Colección de prueba",
			}),
		});
		expect(colRes.status).toBe(201);
		const collection = (await colRes.json()) as { id: string };

		const add = await curatorApp.request(
			`/api/admin/collections/${collection.id}/resources`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ resourceId: draft.id }),
			},
		);
		expect(add.status).toBe(404);
	});

	test("el curator ve sus propios borradores", async () => {
		await ensureUsers();
		const own = await createDraft(curatorApp);
		expect((await listIds(curatorApp, "&status=draft")).ids).toContain(own.id);
		expect(
			(await curatorApp.request(`/api/admin/resources/${own.id}`)).status,
		).toBe(200);
		// Otro curator no.
		expect((await listIds(otherCuratorApp, "&status=draft")).ids).not.toContain(
			own.id,
		);
		expect(
			(await otherCuratorApp.request(`/api/admin/resources/${own.id}`)).status,
		).toBe(403);
	});

	test("al enviarlo a revisión lo ve el curator, y al volver a borrador deja de verlo", async () => {
		await ensureUsers();
		const draft = await createDraft(authorApp);

		expect((await setStatus(authorApp, draft.id, "review")).status).toBe(200);
		expect((await listIds(curatorApp, "&status=review")).ids).toContain(
			draft.id,
		);
		expect(
			(await curatorApp.request(`/api/admin/resources/${draft.id}`)).status,
		).toBe(200);

		// El curator lo devuelve a borrador: vuelve a ser privado del autor.
		expect((await setStatus(curatorApp, draft.id, "draft")).status).toBe(200);
		expect((await listIds(curatorApp)).ids).not.toContain(draft.id);
		expect(
			(await curatorApp.request(`/api/admin/resources/${draft.id}`)).status,
		).toBe(403);
		expect(
			(await authorApp.request(`/api/admin/resources/${draft.id}`)).status,
		).toBe(200);
		expect(
			(await adminApp.request(`/api/admin/resources/${draft.id}`)).status,
		).toBe(200);
	});

	test("el curator no lee ni cambia las etiquetas de un borrador ajeno", async () => {
		await ensureUsers();
		const draft = await createDraft(authorApp);
		const tagsPath = `/api/admin/tags/resources/${draft.id}`;
		const putTags = (app: ReturnType<typeof createAdminApp>, label: string) =>
			app.request(tagsPath, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ labels: [label] }),
			});

		expect((await putTags(authorApp, "etiqueta-autor-460")).status).toBe(200);

		expect((await putTags(curatorApp, "etiqueta-curator-460")).status).toBe(
			403,
		);
		expect((await curatorApp.request(tagsPath)).status).toBe(404);

		// Las etiquetas del autor siguen intactas, y autor y admin las leen.
		for (const app of [authorApp, adminApp]) {
			const res = await app.request(tagsPath);
			expect(res.status).toBe(200);
			const { data } = (await res.json()) as {
				data: Array<{ label: string }>;
			};
			expect(data.map((t) => t.label)).toEqual(["etiqueta-autor-460"]);
		}
		// En revisión el curator ya puede gestionarlas.
		expect((await setStatus(authorApp, draft.id, "review")).status).toBe(200);
		expect((await curatorApp.request(tagsPath)).status).toBe(200);
		expect((await putTags(curatorApp, "etiqueta-curator-460")).status).toBe(
			200,
		);
	});

	test("la ficha pública y los recomendados de un borrador ajeno dan 404 al curator", async () => {
		await ensureUsers();
		const draft = await createDraft(authorApp);
		const { slug } = (await (
			await authorApp.request(`/api/admin/resources/${draft.id}`)
		).json()) as { slug: string };
		const publicApp = new Hono();
		publicApp.route("/api/v1", publicRoutes);

		const getSession = spyOn(auth.api, "getSession");
		const fichaAs = async (id: string, role: string, path = "") => {
			getSession.mockResolvedValue({
				user: { id, role },
				session: { id: "s" },
			} as unknown as Awaited<ReturnType<typeof auth.api.getSession>>);
			return (await publicApp.request(`/api/v1/resources/${slug}${path}`))
				.status;
		};
		try {
			expect(await fichaAs(curatorId, "curator")).toBe(404);
			expect(await fichaAs(curatorId, "curator", "/related")).toBe(404);
			// El autor y el admin sí la ven: la sesión simulada surte efecto.
			expect(await fichaAs(authorId, "author")).toBe(200);
			expect(await fichaAs(adminId, "admin")).toBe(200);
			expect(await fichaAs(adminId, "admin", "/related")).toBe(200);
		} finally {
			getSession.mockRestore();
		}
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

	// #432: el author ya entra en /collections, pero solo para las suyas (las
	// importadas de sus itinerarios). Sin colecciones, el listado sale vacío.
	test("author sin colecciones propias no ve ninguna", async () => {
		const authorApp = createAdminApp({
			id: "author-collections",
			role: "author",
		});
		const res = await authorApp.request("/api/admin/collections");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toEqual([]);
		expect(body.total).toBe(0);
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

	// #486: el estado editorial de una colección solo admite valores válidos.
	test("POST /api/admin/collections → 400 con un estado editorial inventado", async () => {
		const res = await app.request("/api/admin/collections", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Colección con estado inventado",
				description: "No debe guardarse",
				editorialStatus: "foo",
			}),
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(
			body.details.some(
				(e: { field: string }) => e.field === "editorialStatus",
			),
		).toBe(true);
	});

	test("PATCH /api/admin/collections/:id → 400 con un estado inventado y la colección no cambia", async () => {
		const createRes = await app.request("/api/admin/collections", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: "Colección de estado válido",
				description: "Empieza en borrador",
			}),
		});
		expect(createRes.status).toBe(201);
		const { id } = await createRes.json();

		for (const editorialStatus of ["publicado", "foo"]) {
			const patchRes = await app.request(`/api/admin/collections/${id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title: "No debe cambiar",
					editorialStatus,
				}),
			});
			expect(patchRes.status).toBe(400);
			const body = await patchRes.json();
			expect(
				body.details.some(
					(e: { field: string }) => e.field === "editorialStatus",
				),
			).toBe(true);
		}

		const getRes = await app.request(`/api/admin/collections/${id}`);
		const collection = await getRes.json();
		expect(collection.editorialStatus).toBe("draft");
		expect(collection.title).toBe("Colección de estado válido");

		const validRes = await app.request(`/api/admin/collections/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ editorialStatus: "archived" }),
		});
		expect(validRes.status).toBe(200);
		const archived = await (
			await app.request(`/api/admin/collections/${id}`)
		).json();
		expect(archived.editorialStatus).toBe("archived");
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

		// #538: un borrador ajeno ya no lo ve el curator, ni siquiera el del
		// admin (misma regla que #460 en los recursos). Para que este caso siga
		// comprobando lo que comprobaba (que el curator gestiona lo que existe),
		// la coleccion del admin pasa a revision.
		const toReview = await app.request(
			`/api/admin/collections/${adminCollection.id}`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ editorialStatus: "review" }),
			},
		);
		expect(toReview.status).toBe(200);

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
		// #533: un «Sobre mí» vacío se guarda como null.
		expect(body.bio).toBeNull();
	});

	test("PATCH /api/admin/users/:id → rechaza nombre vacío y «Sobre mí» demasiado largo (#533)", async () => {
		const adminApp = createAdminApp({ id: "1", role: "admin" });
		const email = `name-check-${crypto.randomUUID()}@test.com`;
		const createRes = await adminApp.request("/api/admin/users", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "Con Nombre",
				email,
				password: "supersecret8",
			}),
		});
		const { id } = await createRes.json();

		for (const body of [
			{ name: "" },
			{ name: null },
			{ bio: "x".repeat(10_001) },
		]) {
			const res = await adminApp.request(`/api/admin/users/${id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			expect(res.status).toBe(400);
		}

		const getRes = await adminApp.request(`/api/admin/users/${id}`);
		const user = await getRes.json();
		expect(user.name).toBe("Con Nombre");
		expect(user.bio).toBeNull();
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
		// #448: hace falta un área para enviar a revisión o publicar.
		knowledgeAreaIds: ["matematicas"],
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

// #538: a las colecciones se les aplica la regla de #460, que ya rige en los
// recursos: un borrador es privado de quien lo crea y del admin. Hasta ahora
// cualquier curator veia y editaba los borradores de otro curator.
describe("Rutas admin — borradores de coleccion ajenos (#538)", () => {
	const ownerId = "curator-538-dueno";
	const otherId = "curator-538-otro";
	const ownerApp = createAdminApp({ id: ownerId, role: "curator" });
	const otherApp = createAdminApp({ id: otherId, role: "curator" });
	const adminApp = createAdminApp({ id: "admin-538", role: "admin" });

	async function createCollection(
		app: ReturnType<typeof createAdminApp>,
		title: string,
	) {
		const res = await app.request("/api/admin/collections", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ title, description: "Coleccion de prueba #538" }),
		});
		expect(res.status).toBe(201);
		return (await res.json()) as { id: string; editorialStatus: string };
	}

	async function setStatus(
		app: ReturnType<typeof createAdminApp>,
		id: string,
		editorialStatus: string,
	) {
		const res = await app.request(`/api/admin/collections/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ editorialStatus }),
		});
		expect(res.status).toBe(200);
	}

	test("nace en borrador y su dueno lo gestiona", async () => {
		const created = await createCollection(ownerApp, "Borrador propio #538");

		const get = await ownerApp.request(`/api/admin/collections/${created.id}`);
		expect(get.status).toBe(200);
		const body = await get.json();
		expect(body.editorialStatus).toBe("draft");
		expect(body.curatorId).toBe(ownerId);
	});

	test("otro curator no ve ni edita el borrador", async () => {
		const created = await createCollection(ownerApp, "Borrador ajeno #538");

		const get = await otherApp.request(`/api/admin/collections/${created.id}`);
		expect(get.status).toBe(403);

		const patch = await otherApp.request(
			`/api/admin/collections/${created.id}`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "No debe cambiar" }),
			},
		);
		expect(patch.status).toBe(403);

		const del = await otherApp.request(`/api/admin/collections/${created.id}`, {
			method: "DELETE",
		});
		expect(del.status).toBe(403);

		// Las subrutas pasan por el mismo guard.
		const resources = await otherApp.request(
			`/api/admin/collections/${created.id}/resources`,
		);
		expect(resources.status).toBe(403);

		// Y sigue intacta.
		const stillThere = await ownerApp.request(
			`/api/admin/collections/${created.id}`,
		);
		expect((await stillThere.json()).title).toBe("Borrador ajeno #538");
	});

	test("el borrador ajeno no sale en el listado del otro curator", async () => {
		const created = await createCollection(ownerApp, "Oculta en listado #538");

		const own = await ownerApp.request("/api/admin/collections?limit=100");
		const ownIds = (await own.json()).data.map((x: { id: string }) => x.id);
		expect(ownIds).toContain(created.id);

		const other = await otherApp.request("/api/admin/collections?limit=100");
		const otherIds = (await other.json()).data.map((x: { id: string }) => x.id);
		expect(otherIds).not.toContain(created.id);
	});

	test("en revision la ve cualquier curator: es la cola de curacion", async () => {
		const created = await createCollection(ownerApp, "En revision #538");
		await setStatus(ownerApp, created.id, "review");

		const get = await otherApp.request(`/api/admin/collections/${created.id}`);
		expect(get.status).toBe(200);

		const listed = await otherApp.request("/api/admin/collections?limit=100");
		const ids = (await listed.json()).data.map((x: { id: string }) => x.id);
		expect(ids).toContain(created.id);
	});

	test("publicada y archivada las ve cualquier curator", async () => {
		for (const status of ["published", "archived"]) {
			const created = await createCollection(ownerApp, `${status} #538`);
			await setStatus(ownerApp, created.id, status);

			const get = await otherApp.request(
				`/api/admin/collections/${created.id}`,
			);
			expect(get.status).toBe(200);
		}
	});

	test("el admin ve y edita el borrador de cualquier curator", async () => {
		const created = await createCollection(
			ownerApp,
			"Borrador para admin #538",
		);

		const get = await adminApp.request(`/api/admin/collections/${created.id}`);
		expect(get.status).toBe(200);

		const patch = await adminApp.request(
			`/api/admin/collections/${created.id}`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "El admin si puede #538" }),
			},
		);
		expect(patch.status).toBe(200);

		const listed = await adminApp.request("/api/admin/collections?limit=100");
		const ids = (await listed.json()).data.map((x: { id: string }) => x.id);
		expect(ids).toContain(created.id);
	});
});

// #432: los itinerarios importados del Procomún antiguo conservan a su autor
// como propietario (curatorId), aunque sea editor o author. Puede ver y editar
// SUS colecciones y mandarlas a revisión; no puede crear colecciones, ni
// publicarlas o archivarlas, ni borrarlas, ni tocar las ajenas.
describe("Rutas admin — colecciones de su autor no curator (#432)", () => {
	const ownerId = "editor-432-dueno";
	const otherId = "editor-432-otro";
	const authorId = "author-432-dueno";
	const curatorId = "curator-432";
	const ownerApp = createAdminApp({ id: ownerId, role: "editor" });
	const otherApp = createAdminApp({ id: otherId, role: "editor" });
	const authorApp = createAdminApp({ id: authorId, role: "author" });
	const curatorApp = createAdminApp({ id: curatorId, role: "curator" });
	const adminApp = createAdminApp({ id: "1", role: "admin" });
	const json = (body: unknown) => ({
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

	async function importedCollection(
		owner: string,
		editorialStatus = "draft",
		title = `Itinerario importado ${crypto.randomUUID()}`,
	) {
		const db = getDb().db;
		for (const [id, role] of [
			[ownerId, "editor"],
			[otherId, "editor"],
			[authorId, "author"],
			[curatorId, "curator"],
		] as const) {
			await repo.ensureUser(db, { id, email: `${id}@local.invalid`, role });
		}
		return repo.createCollection(db, {
			title,
			description: "Importada del Procomún antiguo",
			curatorId: owner,
			editorialStatus,
			isOrdered: true,
		});
	}

	async function publishedResource() {
		const id = crypto.randomUUID();
		await getDb()
			.db.insert(resourcesTable)
			.values({
				id,
				slug: `recurso-432-${id}`,
				title: "Recurso publicado #432",
				description: "d",
				language: "es",
				license: "cc-by",
				resourceType: "documento",
				editorialStatus: "published",
				createdBy: "1",
			});
		return id;
	}

	test("el propietario editor ve y edita la suya, y gestiona sus recursos", async () => {
		const { id } = await importedCollection(ownerId, "published");

		const get = await ownerApp.request(`/api/admin/collections/${id}`);
		expect(get.status).toBe(200);
		expect((await get.json()).curatorId).toBe(ownerId);

		const patch = await ownerApp.request(`/api/admin/collections/${id}`, {
			method: "PATCH",
			...json({ title: "Título que pone su autor", description: "Nueva" }),
		});
		expect(patch.status).toBe(200);
		const after = await (
			await ownerApp.request(`/api/admin/collections/${id}`)
		).json();
		expect(after).toMatchObject({
			title: "Título que pone su autor",
			description: "Nueva",
			editorialStatus: "published",
		});

		const resourceId = await publishedResource();
		const add = await ownerApp.request(
			`/api/admin/collections/${id}/resources`,
			{ method: "POST", ...json({ resourceId }) },
		);
		expect(add.status).toBe(201);
		const list = await ownerApp.request(
			`/api/admin/collections/${id}/resources`,
		);
		expect(list.status).toBe(200);
		const remove = await ownerApp.request(
			`/api/admin/collections/${id}/resources/${resourceId}`,
			{ method: "DELETE" },
		);
		expect(remove.status).toBe(200);
	});

	test("también vale con rol author", async () => {
		const { id } = await importedCollection(authorId);
		const get = await authorApp.request(`/api/admin/collections/${id}`);
		expect(get.status).toBe(200);
		const patch = await authorApp.request(`/api/admin/collections/${id}`, {
			method: "PATCH",
			...json({ title: "Lo edita su autora" }),
		});
		expect(patch.status).toBe(200);
	});

	test("en su listado solo salen las suyas, no las ajenas aunque estén publicadas", async () => {
		const own = await importedCollection(ownerId);
		const others = await importedCollection(otherId, "published");
		const curators = await importedCollection(curatorId, "review");

		const res = await ownerApp.request("/api/admin/collections?limit=100");
		expect(res.status).toBe(200);
		const body = await res.json();
		const ids = body.data.map((x: { id: string }) => x.id);
		expect(ids).toContain(own.id);
		expect(ids).not.toContain(others.id);
		expect(ids).not.toContain(curators.id);
		expect(
			body.data.every((x: { curatorId: string }) => x.curatorId === ownerId),
		).toBe(true);
	});

	test("otro editor no ve ni edita la ajena, ni sus recursos", async () => {
		const { id } = await importedCollection(ownerId, "published");

		expect(
			(await otherApp.request(`/api/admin/collections/${id}`)).status,
		).toBe(403);
		expect(
			(
				await otherApp.request(`/api/admin/collections/${id}`, {
					method: "PATCH",
					...json({ title: "No es mía" }),
				})
			).status,
		).toBe(403);
		expect(
			(await otherApp.request(`/api/admin/collections/${id}/resources`)).status,
		).toBe(403);
	});

	test("el editor no puede crear colecciones ni borrar la suya", async () => {
		const create = await ownerApp.request("/api/admin/collections", {
			method: "POST",
			...json({ title: "Nueva", description: "No puede" }),
		});
		expect(create.status).toBe(403);

		const { id } = await importedCollection(ownerId);
		const del = await ownerApp.request(`/api/admin/collections/${id}`, {
			method: "DELETE",
		});
		expect(del.status).toBe(403);
		expect(
			(await ownerApp.request(`/api/admin/collections/${id}`)).status,
		).toBe(200);
	});

	test("no puede cambiarse el propietario", async () => {
		const { id } = await importedCollection(ownerId);
		const patch = await ownerApp.request(`/api/admin/collections/${id}`, {
			method: "PATCH",
			...json({ title: "Sigue siendo mía", curatorId: otherId }),
		});
		expect(patch.status).toBe(200);
		const after = await (
			await ownerApp.request(`/api/admin/collections/${id}`)
		).json();
		expect(after.curatorId).toBe(ownerId);
	});

	test("puede mandar su borrador a revisión, pero no publicar ni archivar", async () => {
		const draft = await importedCollection(ownerId);
		const publish = await ownerApp.request(
			`/api/admin/collections/${draft.id}`,
			{ method: "PATCH", ...json({ editorialStatus: "published" }) },
		);
		expect(publish.status).toBe(400);

		const toReview = await ownerApp.request(
			`/api/admin/collections/${draft.id}`,
			{ method: "PATCH", ...json({ editorialStatus: "review" }) },
		);
		expect(toReview.status).toBe(200);
		// En revisión es de la cola de curación: no la devuelve él a borrador.
		const back = await ownerApp.request(`/api/admin/collections/${draft.id}`, {
			method: "PATCH",
			...json({ editorialStatus: "draft" }),
		});
		expect(back.status).toBe(400);

		const published = await importedCollection(ownerId, "published");
		const archive = await ownerApp.request(
			`/api/admin/collections/${published.id}`,
			{ method: "PATCH", ...json({ editorialStatus: "archived" }) },
		);
		expect(archive.status).toBe(400);
		// Mandar el estado que ya tiene no es un cambio de estado.
		const same = await ownerApp.request(
			`/api/admin/collections/${published.id}`,
			{
				method: "PATCH",
				...json({ editorialStatus: "published", title: "Mismo estado" }),
			},
		);
		expect(same.status).toBe(200);

		// El curator la publica desde la cola de revisión, como hasta ahora.
		const curatorPublish = await curatorApp.request(
			`/api/admin/collections/${draft.id}`,
			{ method: "PATCH", ...json({ editorialStatus: "published" }) },
		);
		expect(curatorPublish.status).toBe(200);
	});

	test("un reader no entra aunque figure como propietario", async () => {
		const db = getDb().db;
		await repo.ensureUser(db, {
			id: "reader-432",
			email: "reader-432@local.invalid",
			role: "reader",
		});
		const { id } = await repo.createCollection(db, {
			title: "De un reader",
			description: "x",
			curatorId: "reader-432",
		});
		const readerApp = createAdminApp({ id: "reader-432", role: "reader" });
		expect(
			(await readerApp.request(`/api/admin/collections/${id}`)).status,
		).toBe(403);
	});

	test("curator y admin siguen como en #538 con las colecciones importadas", async () => {
		const draft = await importedCollection(ownerId);
		const published = await importedCollection(ownerId, "published");

		// El borrador del autor es suyo: el curator no lo ve; el admin, sí.
		expect(
			(await curatorApp.request(`/api/admin/collections/${draft.id}`)).status,
		).toBe(403);
		expect(
			(await adminApp.request(`/api/admin/collections/${draft.id}`)).status,
		).toBe(200);
		expect(
			(await curatorApp.request(`/api/admin/collections/${published.id}`))
				.status,
		).toBe(200);
		// El curator sigue creando colecciones.
		const create = await curatorApp.request("/api/admin/collections", {
			method: "POST",
			...json({ title: "Del curator #432", description: "Sí puede" }),
		});
		expect(create.status).toBe(201);
	});
});
