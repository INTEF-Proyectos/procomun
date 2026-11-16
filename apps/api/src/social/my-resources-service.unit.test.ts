import { describe, expect, test } from "bun:test";
import * as repo from "@procomun/db/repository";
import { getDb } from "../db.ts";
import {
	listMyResources,
	parseMyResourcesStatus,
} from "./my-resources-service.ts";

async function createUser(prefix: string) {
	const userId = `${prefix}-${crypto.randomUUID()}`;
	await repo.ensureUser(getDb().db, {
		id: userId,
		email: `${userId}@local.invalid`,
		name: "Autora Mis Recursos",
		role: "author",
	});
	return userId;
}

async function createOwn(
	userId: string,
	title: string,
	status: "draft" | "review" | "published" | "archived",
	extra: { resourceType?: string; knowledgeAreaIds?: string[] } = {},
) {
	const db = getDb().db;
	const created = await repo.createResource(db, {
		title,
		description: "desc",
		language: "es",
		license: "cc-by",
		resourceType: extra.resourceType ?? "documento",
		knowledgeAreaIds: extra.knowledgeAreaIds,
		createdBy: userId,
	});
	if (status !== "draft") {
		await repo.updateEditorialStatus(db, created.id, status, userId);
	}
	return created;
}

describe("listMyResources (#530)", () => {
	test("lista todos los recursos propios, más de 5, paginados", async () => {
		const userId = await createUser("mis-recursos-pag");
		for (let i = 0; i < 7; i += 1) {
			await createOwn(userId, `Paginado ${i}`, "draft");
		}

		const first = await listMyResources(userId, { limit: 4, offset: 0 });
		const second = await listMyResources(userId, { limit: 4, offset: 4 });

		expect(first.total).toBe(7);
		expect(first.data).toHaveLength(4);
		expect(second.data).toHaveLength(3);
		const ids = new Set([...first.data, ...second.data].map((r) => r.id));
		expect(ids.size).toBe(7);
	});

	test("incluye los cuatro estados y cuenta cada uno, también en revisión y archivados", async () => {
		const userId = await createUser("mis-recursos-estados");
		await createOwn(userId, "Borrador", "draft");
		await createOwn(userId, "En revisión", "review");
		await createOwn(userId, "Publicado A", "published");
		await createOwn(userId, "Publicado B", "published");
		await createOwn(userId, "Archivado", "archived");

		const all = await listMyResources(userId, { limit: 20, offset: 0 });
		expect(all.total).toBe(5);
		expect(all.statusCounts).toEqual({
			draft: 1,
			review: 1,
			published: 2,
			archived: 1,
			total: 5,
		});

		const review = await listMyResources(userId, {
			status: "review",
			limit: 20,
			offset: 0,
		});
		expect(review.data.map((r) => r.title)).toEqual(["En revisión"]);
		expect(review.total).toBe(1);
		// Los contadores no dependen del estado elegido: cuadran con «Todos».
		expect(review.statusCounts.total).toBe(5);

		const archived = await listMyResources(userId, {
			status: "archived",
			limit: 20,
			offset: 0,
		});
		expect(archived.data.map((r) => r.title)).toEqual(["Archivado"]);
	});

	test("no enseña recursos ajenos ni eliminados", async () => {
		const userId = await createUser("mis-recursos-propios");
		const otherId = await createUser("mis-recursos-ajeno");
		await createOwn(userId, "Mío", "draft");
		const gone = await createOwn(userId, "Borrado", "draft");
		await createOwn(otherId, "Ajeno", "published");
		await repo.deleteResource(getDb().db, gone.id);

		const result = await listMyResources(userId, { limit: 20, offset: 0 });
		expect(result.data.map((r) => r.title)).toEqual(["Mío"]);
		expect(result.statusCounts.total).toBe(1);
	});

	test("filtra por texto, tipo y área, y los contadores siguen esos filtros", async () => {
		const userId = await createUser("mis-recursos-filtros");
		await createOwn(userId, "Fracciones en vídeo", "published", {
			resourceType: "video",
			knowledgeAreaIds: ["matematicas"],
		});
		await createOwn(userId, "Fracciones en documento", "draft", {
			resourceType: "documento",
		});
		await createOwn(userId, "Poesía", "draft");

		const byText = await listMyResources(userId, {
			search: "fracciones",
			limit: 20,
			offset: 0,
		});
		expect(byText.total).toBe(2);
		expect(byText.statusCounts).toEqual({
			draft: 1,
			review: 0,
			published: 1,
			archived: 0,
			total: 2,
		});

		const byType = await listMyResources(userId, {
			resourceType: "video",
			limit: 20,
			offset: 0,
		});
		expect(byType.data.map((r) => r.title)).toEqual(["Fracciones en vídeo"]);

		const byArea = await listMyResources(userId, {
			knowledgeAreaIds: ["matematicas"],
			limit: 20,
			offset: 0,
		});
		expect(byArea.data.map((r) => r.title)).toEqual(["Fracciones en vídeo"]);
	});

	test("devuelve las tarjetas enriquecidas y lo último editado primero", async () => {
		const userId = await createUser("mis-recursos-orden");
		const older = await createOwn(userId, "Antiguo", "draft");
		await createOwn(userId, "Nuevo", "draft");
		await repo.updateResource(getDb().db, older.id, {
			title: "Antiguo editado",
		});

		const result = await listMyResources(userId, { limit: 20, offset: 0 });
		expect(result.data[0]?.title).toBe("Antiguo editado");
		expect(result.data[0]?.rating).toEqual({ average: 0, count: 0 });
		expect(result.data[0]?.editorialStatus).toBe("draft");
	});
});

describe("parseMyResourcesStatus (#530)", () => {
	test("acepta los cuatro estados y trata el vacío como todos", () => {
		expect(parseMyResourcesStatus("draft")).toEqual({
			ok: true,
			status: "draft",
		});
		expect(parseMyResourcesStatus("review")).toEqual({
			ok: true,
			status: "review",
		});
		expect(parseMyResourcesStatus("published")).toEqual({
			ok: true,
			status: "published",
		});
		expect(parseMyResourcesStatus("archived")).toEqual({
			ok: true,
			status: "archived",
		});
		expect(parseMyResourcesStatus(undefined)).toEqual({
			ok: true,
			status: undefined,
		});
		expect(parseMyResourcesStatus("")).toEqual({ ok: true, status: undefined });
	});

	test("rechaza un estado desconocido", () => {
		expect(parseMyResourcesStatus("borrado")).toEqual({ ok: false });
	});
});
