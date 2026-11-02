import { beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import {
	KNOWLEDGE_AREA_MESSAGES,
	KNOWLEDGE_AREA_SEED,
} from "../knowledge-areas.ts";
import { createResource, ensureUser } from "../repository.ts";
import * as schema from "../schema/index.ts";
import { createTables } from "../setup.ts";
import {
	createCatalogKeyword,
	listResourceCatalogKeywords,
	searchCatalogKeywords,
	setResourceCatalogKeywords,
} from "./keyword-catalog.ts";
import {
	createKnowledgeArea,
	crossKeywordCatalogWithAreas,
	listKnowledgeAreas,
	listResourceKnowledgeAreas,
	listResourceProfessionalFamilies,
	retireCatalogKeywords,
	setResourceKnowledgeAreas,
	setResourceProfessionalFamilies,
	updateKnowledgeArea,
} from "./knowledge-areas.ts";
import type { DrizzleDB } from "./shared.ts";

describe("repositorio de áreas de conocimiento (#448)", () => {
	let client: PGlite;
	let db: DrizzleDB;
	let userId: string;

	async function newResource(extra: Record<string, unknown> = {}) {
		const { id } = await createResource(db, {
			title: `Recurso ${crypto.randomUUID()}`,
			description: "desc",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			createdBy: userId,
			...extra,
		});
		return id;
	}

	beforeEach(async () => {
		client = new PGlite();
		await createTables(client);
		db = drizzle(client, { schema }) as unknown as DrizzleDB;
		userId = crypto.randomUUID();
		await ensureUser(db, {
			id: userId,
			email: `${userId}@areas.test`,
			name: "Curator",
			role: "curator",
		});
	});

	test("siembra el catálogo inicial en el orden de los bloques", async () => {
		const areas = await listKnowledgeAreas(db);
		expect(areas).toHaveLength(KNOWLEDGE_AREA_SEED.length);
		expect(areas[0]).toMatchObject({
			id: "artes-escenicas",
			blockId: "artes",
			active: true,
			usageCount: 0,
		});
		expect(areas.at(-1)?.blockId).toBe("inclusion");
	});

	test("repetir la creación de tablas no duplica ni pisa áreas editadas", async () => {
		await updateKnowledgeArea(db, "musica", { label: "Música y danza" });
		await createTables(client);
		const areas = await listKnowledgeAreas(db);
		expect(areas).toHaveLength(KNOWLEDGE_AREA_SEED.length);
		expect(areas.find((area) => area.id === "musica")?.label).toBe(
			"Música y danza",
		);
	});

	test("el alta rechaza una denominación repetida sin mirar mayúsculas ni tildes", async () => {
		const result = await createKnowledgeArea(db, {
			label: "  QUIMICA ",
			blockId: "ciencias",
			createdBy: userId,
		});
		expect(result).toMatchObject({
			status: "duplicate",
			area: { id: "quimica" },
		});
	});

	test("el alta crea un id estable a partir de la denominación", async () => {
		const result = await createKnowledgeArea(db, {
			label: "Cine y Series",
			description: "Lenguaje cinematográfico",
			blockId: "artes",
			createdBy: userId,
		});
		expect(result).toMatchObject({
			status: "created",
			area: {
				id: "cine-y-series",
				label: "Cine y Series",
				description: "Lenguaje cinematográfico",
				blockId: "artes",
				active: true,
			},
		});
		expect(
			await createKnowledgeArea(db, {
				label: "Cine",
				blockId: "no-existe",
				createdBy: userId,
			}),
		).toEqual({
			status: "invalid",
			message: KNOWLEDGE_AREA_MESSAGES.unknownBlock,
		});
	});

	test("renombrar o mover de bloque conserva el id y las asociaciones", async () => {
		const resourceId = await newResource();
		await setResourceKnowledgeAreas(db, resourceId, ["fisica"]);
		const result = await updateKnowledgeArea(db, "fisica", {
			label: "Física y Química",
			blockId: "humanidades",
		});
		expect(result).toMatchObject({
			status: "updated",
			area: { id: "fisica", label: "Física y Química", usageCount: 1 },
		});
		expect(await listResourceKnowledgeAreas(db, resourceId)).toEqual([
			{
				id: "fisica",
				label: "Física y Química",
				blockId: "humanidades",
				active: true,
			},
		]);
		expect(
			await updateKnowledgeArea(db, "fisica", { label: "Historia" }),
		).toMatchObject({ status: "duplicate", area: { id: "historia" } });
		expect(
			await updateKnowledgeArea(db, "no-existe", { active: false }),
		).toEqual({ status: "not_found" });
	});

	test("desactivar conserva la asociación y deja de ofrecer el área", async () => {
		const withArea = await newResource();
		await setResourceKnowledgeAreas(db, withArea, ["ajedrez"]);
		await updateKnowledgeArea(db, "ajedrez", { active: false });

		expect((await listKnowledgeAreas(db)).map((area) => area.id)).not.toContain(
			"ajedrez",
		);
		expect(
			(await listKnowledgeAreas(db, { includeInactive: true })).find(
				(area) => area.id === "ajedrez",
			),
		).toMatchObject({ active: false, usageCount: 1 });
		// El recurso que ya la tenía puede volver a guardarla.
		await setResourceKnowledgeAreas(db, withArea, ["ajedrez", "matematicas"]);
		expect(
			(await listResourceKnowledgeAreas(db, withArea)).map((area) => area.id),
		).toEqual(["ajedrez", "matematicas"]);
		// Un recurso nuevo no.
		const other = await newResource();
		await expect(
			setResourceKnowledgeAreas(db, other, ["ajedrez"]),
		).rejects.toThrow(KNOWLEDGE_AREA_MESSAGES.inactiveArea);
	});

	test("como máximo 3 áreas por recurso y solo del catálogo", async () => {
		const resourceId = await newResource();
		await expect(
			setResourceKnowledgeAreas(db, resourceId, [
				"fisica",
				"quimica",
				"biologia",
				"geologia",
			]),
		).rejects.toThrow(KNOWLEDGE_AREA_MESSAGES.max);
		await expect(
			setResourceKnowledgeAreas(db, resourceId, ["inventada"]),
		).rejects.toThrow(KNOWLEDGE_AREA_MESSAGES.unknownArea);
		await setResourceKnowledgeAreas(db, resourceId, ["fisica", "quimica"]);
		await setResourceKnowledgeAreas(db, resourceId, ["quimica"]);
		expect(
			(await listResourceKnowledgeAreas(db, resourceId)).map((area) => area.id),
		).toEqual(["quimica"]);
	});

	test("las familias profesionales solo se guardan en recursos de FP", async () => {
		const primaria = await newResource({
			educationalAreas: [{ categoryId: "educacion-primaria", optionId: null }],
		});
		await expect(
			setResourceProfessionalFamilies(db, primaria, ["sanidad"]),
		).rejects.toThrow(KNOWLEDGE_AREA_MESSAGES.familyRequiresFp);

		const fp = await newResource({
			educationalAreas: [
				{ categoryId: "formacion-profesional", optionId: null },
			],
		});
		await setResourceProfessionalFamilies(db, fp, [
			"sanidad",
			"hosteleria-y-turismo",
		]);
		expect(await listResourceProfessionalFamilies(db, fp)).toEqual([
			"hosteleria-y-turismo",
			"sanidad",
		]);
		await setResourceProfessionalFamilies(db, fp, []);
		expect(await listResourceProfessionalFamilies(db, fp)).toEqual([]);
	});
});

describe("cruce del catálogo de palabras clave con las áreas (#384, #448)", () => {
	let db: DrizzleDB;
	let userId: string;

	beforeEach(async () => {
		const client = new PGlite();
		await createTables(client);
		db = drizzle(client, { schema }) as unknown as DrizzleDB;
		userId = crypto.randomUUID();
		await ensureUser(db, {
			id: userId,
			email: `${userId}@cruce.test`,
			name: "Curator",
			role: "curator",
		});
	});

	test("separa idénticas, a revisar y sin área equivalente", async () => {
		await createCatalogKeyword(db, { label: "Flamenco", createdBy: userId });
		const crossing = await crossKeywordCatalogWithAreas(db);

		const identical = crossing.identical.map((item) => item.keyword.label);
		expect(identical).toEqual(
			expect.arrayContaining([
				"Biología",
				"Física",
				"Química",
				"Matemáticas",
				"Historia",
				"Robótica",
				"Inteligencia artificial",
			]),
		);
		expect(
			crossing.identical.find(
				(item) => item.keyword.label === "Inteligencia artificial",
			)?.area,
		).toEqual({
			id: "inteligencia-artificial",
			label: "Inteligencia Artificial",
		});

		expect(
			crossing.review.find((item) => item.keyword.id === "informatica")?.areas,
		).toEqual([
			{
				id: "informatica-y-pensamiento-computacional",
				label: "Informática y Pensamiento Computacional",
			},
		]);
		expect(crossing.keep.map((keyword) => keyword.label)).toEqual(
			expect.arrayContaining(["Flamenco", "Geometría"]),
		);
		expect(identical).not.toContain("Flamenco");
	});

	test("una palabra clave retirada no se ofrece ni se puede añadir, pero se conserva", async () => {
		const { id: resourceId } = await createResource(db, {
			title: "Recurso con Biología",
			description: "desc",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			createdBy: userId,
			keywordIds: ["biologia"],
		});
		expect(await retireCatalogKeywords(db, ["biologia"])).toEqual(["biologia"]);
		expect(await retireCatalogKeywords(db, ["biologia"])).toEqual([]);

		expect(
			(await searchCatalogKeywords(db, "biolog")).map((item) => item.id),
		).not.toContain("biologia");
		// El recurso que ya la tenía la conserva al volver a guardar.
		await setResourceCatalogKeywords(db, resourceId, ["biologia", "geometria"]);
		expect(
			(await listResourceCatalogKeywords(db, resourceId)).map(
				(item) => item.id,
			),
		).toEqual(["biologia", "geometria"]);
		// Otro recurso no puede añadirla.
		await expect(
			createResource(db, {
				title: "Otro",
				description: "desc",
				language: "es",
				license: "cc-by",
				resourceType: "documento",
				createdBy: userId,
				keywordIds: ["biologia"],
			}),
		).rejects.toThrow("se ha retirado del catálogo");
		// Y no se puede volver a dar de alta con la misma denominación.
		expect(
			await createCatalogKeyword(db, { label: "biología", createdBy: userId }),
		).toMatchObject({ status: "duplicate", keyword: { id: "biologia" } });
		expect(
			(await crossKeywordCatalogWithAreas(db)).identical.find(
				(item) => item.keyword.id === "biologia",
			)?.keyword,
		).toMatchObject({ retired: true, resources: 1 });
	});
});
