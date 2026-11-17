import { describe, expect, test } from "bun:test";
import { KEYWORD_MESSAGES } from "@procomun/db/keyword-catalog";
import * as repo from "@procomun/db/repository";
import { resources } from "@procomun/db/schema";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { getDb } from "../db.ts";
import { loadRecommendationSignalRows } from "../recommendations/service.ts";
import { adminRoutes } from "./admin/index.ts";
import { apiResourceRoutes } from "./api-resources.ts";
import { keywordRoutes } from "./keywords.ts";

const db = () => getDb().db;

function appAs(mockUser: Record<string, unknown>) {
	const app = new Hono<AuthEnv>();
	app.use("*", async (c, next) => {
		c.set("user", mockUser as AuthEnv["Variables"]["user"]);
		c.set("session", { id: "s" } as AuthEnv["Variables"]["session"]);
		await next();
	});
	app.route("/api/admin", adminRoutes);
	app.route("/api/v1/keywords", keywordRoutes);
	app.route("/api/v1/publish/resources", apiResourceRoutes);
	return app;
}

function send(
	app: ReturnType<typeof appAs>,
	method: string,
	path: string,
	body: unknown,
) {
	return app.request(path, {
		method,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

const author = appAs({ id: "1", role: "author" });
const curator = appAs({
	id: "curator-keywords",
	role: "curator",
	email: "curator-keywords@test.com",
});
const admin = appAs({ id: "1", role: "admin" });

const resourceBody = {
	description: "Recurso con palabras clave",
	language: "es",
	license: "cc-by",
	resourceType: "documento",
	author: "Autora de prueba",
};

describe("Catálogo de palabras clave (#384)", () => {
	test("un author no puede dar de alta una palabra clave", async () => {
		const res = await send(author, "POST", "/api/admin/keywords", {
			label: "Autor bloqueado",
			confirm: true,
		});
		expect(res.status).toBe(403);
	});

	test("el curator confirma el alta, queda registrado y no duplica", async () => {
		const label = `Oratoria ${crypto.randomUUID().slice(0, 8)}`;
		const unconfirmed = await send(curator, "POST", "/api/admin/keywords", {
			label,
		});
		expect(unconfirmed.status).toBe(400);

		const created = await send(curator, "POST", "/api/admin/keywords", {
			label,
			aliases: [`debate ${label}`],
			confirm: true,
		});
		expect(created.status).toBe(201);
		const keyword = await created.json();
		const stored = await repo.getTagById(db(), keyword.id);
		expect(stored?.createdBy).toBe("curator-keywords");
		expect(stored?.catalog).toBe(true);

		const byAlias = await author.request(
			`/api/v1/keywords?q=${encodeURIComponent(`debate ${label}`)}`,
		);
		expect((await byAlias.json()).data[0]).toMatchObject({
			id: keyword.id,
			match: "alias",
		});

		const duplicate = await send(curator, "POST", "/api/admin/keywords", {
			label: label.toUpperCase(),
			confirm: true,
		});
		expect(duplicate.status).toBe(409);
		expect((await duplicate.json()).keyword.id).toBe(keyword.id);
	});

	test("la búsqueda del filtro añade las etiquetas libres anteriores", async () => {
		await repo.ensureTag(db(), "Geometría dinámica libre");
		const field = await (
			await author.request("/api/v1/keywords?q=geometria")
		).json();
		expect(field.data[0]).toMatchObject({ label: "Geometría", match: "label" });
		expect(
			field.data.some((item: { match: string }) => item.match === "tag"),
		).toBe(false);

		const filter = await (
			await author.request("/api/v1/keywords?q=geometria&tags=1")
		).json();
		expect(filter.data).toContainEqual(
			expect.objectContaining({
				label: "Geometría dinámica libre",
				match: "tag",
			}),
		);
	});

	test("keywordIds va en el mismo alta y edición, y una selección inválida no crea nada", async () => {
		const title = `Atómico ${crypto.randomUUID().slice(0, 8)}`;
		const tooMany = await send(admin, "POST", "/api/admin/resources", {
			...resourceBody,
			title,
			keywordIds: [
				"historia",
				"geografia",
				"musica",
				"fisica",
				"quimica",
				"biologia",
			],
		});
		expect(tooMany.status).toBe(400);
		expect((await tooMany.json()).error).toBe(KEYWORD_MESSAGES.max);
		const orphan = await db()
			.select({ id: resources.id })
			.from(resources)
			.where(eq(resources.title, title));
		expect(orphan).toHaveLength(0);

		const created = await send(admin, "POST", "/api/admin/resources", {
			...resourceBody,
			title,
			keywordIds: ["astronomia"],
		});
		expect(created.status).toBe(201);
		const { id } = await created.json();

		const edited = await send(admin, "PATCH", `/api/admin/resources/${id}`, {
			keywordIds: ["astronomia", "fisica"],
		});
		expect(edited.status).toBe(200);
		const unknown = await send(admin, "PATCH", `/api/admin/resources/${id}`, {
			title: "No debe guardarse",
			keywordIds: ["no-existe"],
		});
		expect(unknown.status).toBe(400);

		const detail = await (
			await admin.request(`/api/admin/resources/${id}`)
		).json();
		expect(detail.title).toBe(title);
		expect(detail.catalogKeywords.map((k: { id: string }) => k.id)).toEqual([
			"astronomia",
			"fisica",
		]);
	});

	test("lo elegido llega a FTS, feeds, API v1 y recomendaciones", async () => {
		const marker = crypto.randomUUID().slice(0, 8);
		const created = await send(admin, "POST", "/api/admin/resources", {
			...resourceBody,
			title: `Proyección ${marker}`,
			keywords: "texto de origen",
			keywordIds: ["astronomia"],
		});
		const { id } = await created.json();
		await repo.updateEditorialStatus(db(), id, "published", "1", {
			validationSeal: "grant",
		});

		const vector = await db().execute(
			sql`select search_vector::text as v from resources where id = ${id}`,
		);
		expect(JSON.stringify(vector)).toContain("astronom");

		const v1 = await (
			await admin.request(`/api/v1/publish/resources/${id}`)
		).json();
		expect(v1.keywords).toBe("texto de origen");
		expect(v1.catalogKeywords).toEqual([
			{ id: "astronomia", slug: "astronomia", label: "Astronomía" },
		]);

		// Los feeds leen `catalogLabels` del listado (buildFeed se prueba aparte).
		const listed = await repo.listResources(db(), { search: marker });
		expect(listed.data[0]?.catalogLabels).toBe("Astronomía");

		const other = await repo.createResource(db(), {
			...resourceBody,
			resourceType: `tipo-${marker}`,
			title: `Vecino ${crypto.randomUUID().slice(0, 8)}`,
			editorialStatus: "published",
			keywordIds: ["astronomia"],
		});
		await repo.updateEditorialStatus(db(), other.id, "published", "1", {
			validationSeal: "grant",
		});
		// Señales en bruto: el ranking y el límite dependen del resto del fondo.
		const signals = await loadRecommendationSignalRows(db(), id);
		const neighbour = signals.find((row) => row.id === other.id);
		expect(Number(neighbour?.shared_keywords)).toBe(1);
	});
});
