import { describe, expect, test } from "bun:test";
import * as repo from "@procomun/db/repository";
import { resources } from "@procomun/db/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { getDb } from "../db.ts";
import { buildGeneralFeed, buildUserFeed } from "../feeds/service.ts";
import { updateSearchVector } from "../fts/search.ts";
import { adminRoutes } from "../routes/admin/index.ts";
import { publicRoutes } from "../routes/public.ts";

// #568: en los buscadores, Novedades, el feed general y los relacionados solo
// salen los recursos publicados con el sello «Validado» (#420). Un publicado
// sin sello se sigue viendo por enlace directo, en la ficha de su autor y
// dentro de las colecciones (decisión de la issue, 2026-11-16).

type App = Hono<AuthEnv>;
type SessionUser = { id: string; role: string; email: string; name: string };

async function sessionUser(role: string): Promise<SessionUser> {
	const id = `${role}-${crypto.randomUUID()}`;
	const user = { id, role, email: `${id}@local.invalid`, name: `User ${id}` };
	await repo.ensureUser(getDb().db, user);
	return user;
}

function appFor(user: SessionUser): App {
	const app = new Hono<AuthEnv>();
	app.use("*", async (c, next) => {
		c.set("user", user as AuthEnv["Variables"]["user"]);
		c.set("session", { id: "s" } as AuthEnv["Variables"]["session"]);
		await next();
	});
	app.route("/api/admin", adminRoutes);
	return app;
}

const publicApp = new Hono<AuthEnv>();
publicApp.route("/api/v1", publicRoutes);

function patch(app: App, url: string, body: unknown) {
	return app.request(url, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

/**
 * Dos recursos publicados por el mismo editor, uno con sello y otro sin él,
 * con una marca común para aislarlos del resto de la base.
 */
async function fixture() {
	const token = `zq${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
	const author = await sessionUser("editor");
	const curator = await sessionUser("curator");
	const authorApp = appFor(author);

	async function create(title: string) {
		const res = await authorApp.request("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				title: `${title} ${token}`,
				description: `Descripción completa ${token}`,
				language: "es",
				license: "cc-by",
				resourceType: "documento",
				author: "Autora de prueba",
				keywords: `${token},geometria`,
				knowledgeAreaIds: ["matematicas"],
			}),
		});
		expect(res.status).toBe(201);
		return (await res.json()) as { id: string; slug: string };
	}

	const validated = await create("Validado");
	const unvalidated = await create("Sin validar");
	for (const { id } of [validated, unvalidated]) {
		expect(
			(
				await patch(authorApp, `/api/admin/resources/${id}/status`, {
					status: "published",
				})
			).status,
		).toBe(200);
	}
	// La publicación directa de un editor no pone el sello (#420): se pone a
	// mano, como lo dejaría «Aprobar y publicar» de un curator.
	await getDb()
		.db.update(resources)
		.set({
			validatedAt: new Date(),
			validatedBy: curator.id,
			validationSource: "review",
		})
		.where(eq(resources.id, validated.id));

	for (const id of [validated.id, unvalidated.id]) {
		await updateSearchVector(getDb().db, id);
	}

	return { token, author, authorApp, validated, unvalidated };
}

type Listing = { data: { id: string }[]; total: number };

async function listIds(url: string) {
	const res = await publicApp.request(url);
	expect(res.status).toBe(200);
	const body = (await res.json()) as Listing;
	return { ids: body.data.map((r) => r.id), total: body.total };
}

describe("solo validados en las superficies de descubrimiento (#568)", () => {
	test("el listado público (catálogo y Novedades) solo trae validados, y el total cuadra", async () => {
		const f = await fixture();
		const { ids, total } = await listIds(`/api/v1/resources?q=${f.token}`);
		expect(ids).toEqual([f.validated.id]);
		expect(total).toBe(1);
	});

	test("la búsqueda de texto completo solo trae validados", async () => {
		const f = await fixture();
		const { ids, total } = await listIds(`/api/v1/search?q=${f.token}`);
		expect(ids).toEqual([f.validated.id]);
		expect(total).toBe(1);
	});

	test("el feed general no incluye los recursos sin validar", async () => {
		const f = await fixture();
		const xml = await buildGeneralFeed({
			baseUrl: "https://procomun.test",
			search: f.token,
		}).then((feed) => feed.atom1());
		expect(xml).toContain(f.validated.slug);
		expect(xml).not.toContain(f.unvalidated.slug);
	});

	test("los relacionados de la ficha no proponen recursos sin validar", async () => {
		const f = await fixture();
		const res = await publicApp.request(
			`/api/v1/resources/${f.validated.slug}/related`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data?: { id: string }[] };
		const ids = (body.data ?? (body as unknown as { id: string }[])).map(
			(r) => r.id,
		);
		expect(ids).not.toContain(f.unvalidated.id);
	});

	test("si pierde el sello, deja de salir en el listado pero sigue por enlace directo", async () => {
		const f = await fixture();
		// Una edición del autor quita el sello (#420).
		expect(
			(
				await patch(f.authorApp, `/api/admin/resources/${f.validated.id}`, {
					title: `Editado ${f.token}`,
				})
			).status,
		).toBe(200);

		const { ids } = await listIds(`/api/v1/resources?q=${f.token}`);
		expect(ids).toEqual([]);

		const detail = await publicApp.request(
			`/api/v1/resources/${f.validated.slug}`,
		);
		expect(detail.status).toBe(200);
	});
});

describe("excepciones: enlace directo, autor y colecciones (#568)", () => {
	test("un publicado sin validar se abre por su enlace directo", async () => {
		const f = await fixture();
		const res = await publicApp.request(
			`/api/v1/resources/${f.unvalidated.slug}`,
		);
		expect(res.status).toBe(200);
	});

	test("la ficha del autor trae sus publicados, validados o no", async () => {
		const f = await fixture();
		const { ids } = await listIds(`/api/v1/authors/${f.author.id}`);
		expect(ids.sort()).toEqual([f.validated.id, f.unvalidated.id].sort());
	});

	test("el feed del autor también los trae todos", async () => {
		const f = await fixture();
		const xml = await buildUserFeed({
			baseUrl: "https://procomun.test",
			createdBy: f.author.id,
		}).then((feed) => feed.atom1());
		expect(xml).toContain(f.validated.slug);
		expect(xml).toContain(f.unvalidated.slug);
	});

	test("una colección publicada muestra sus recursos publicados sin validar", async () => {
		const f = await fixture();
		const curator = await sessionUser("curator");
		const collection = await repo.createCollection(getDb().db, {
			title: `Colección ${f.token}`,
			description: "Colección de prueba",
			curatorId: curator.id,
			editorialStatus: "published",
		});
		await repo.addResourceToCollection(
			getDb().db,
			collection.id,
			f.unvalidated.id,
		);
		const res = await publicApp.request(
			`/api/v1/collections/${collection.slug}`,
		);
		expect(res.status).toBe(200);
		expect(JSON.stringify(await res.json())).toContain(f.unvalidated.id);
	});
});
