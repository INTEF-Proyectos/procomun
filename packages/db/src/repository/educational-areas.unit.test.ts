import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { EducationalAreaValidationError } from "../educational-areas.ts";
import {
	createResource,
	getResourceById,
	listResources,
	updateResource,
} from "../repository.ts";
import * as schema from "../schema/index.ts";
import { createTables } from "../setup.ts";
import type { DrizzleDB } from "./shared.ts";

async function published(
	db: DrizzleDB,
	title: string,
	extra: Record<string, unknown> = {},
) {
	return createResource(db, {
		title,
		description: `Descripción de ${title}`,
		language: "es",
		license: "cc-by",
		resourceType: "documento",
		editorialStatus: "published",
		...extra,
	});
}

describe("resource_educational_areas", () => {
	let db: DrizzleDB;
	let pglite: PGlite;

	beforeEach(async () => {
		pglite = new PGlite();
		await createTables(pglite);
		db = drizzle(pglite, { schema });
	});

	afterEach(async () => {
		await pglite.close();
	});

	test("guarda solo categoría y varias opciones, y las devuelve en el orden del catálogo", async () => {
		const created = await published(db, "Recurso mixto", {
			educationalAreas: [
				{ categoryId: "bachillerato", optionId: null },
				{
					categoryId: "educacion-secundaria-obligatoria",
					optionId: "eso-3-4",
				},
				{ categoryId: "pdc", optionId: "ambito-linguistico-social" },
				{ categoryId: "pdc", optionId: "otro-ambito" },
			],
			subjects: ["Matemáticas"],
			levels: ["nivel libre"],
		});

		const stored = await getResourceById(db, created.id);
		expect(stored?.subjects).toEqual(["Matemáticas"]);
		expect(stored?.levels).toEqual(["nivel libre"]);
		// ESO va antes que Bachillerato en el catálogo, aunque su id sea mayor.
		expect(stored?.educationalAreas).toEqual([
			{
				categoryId: "educacion-secundaria-obligatoria",
				optionId: "eso-3-4",
			},
			{ categoryId: "bachillerato", optionId: null },
			{ categoryId: "pdc", optionId: "ambito-linguistico-social" },
			{ categoryId: "pdc", optionId: "otro-ambito" },
		]);
	});

	test("borrar una categoría borra sus opciones y no las demás", async () => {
		const created = await published(db, "Dos categorías", {
			educationalAreas: [
				{ categoryId: "educacion-primaria", optionId: "primer-tramo" },
				{ categoryId: "educacion-primaria", optionId: "segundo-tramo" },
				{ categoryId: "ele", optionId: "avanzado" },
			],
		});

		await updateResource(db, created.id, {
			educationalAreas: [{ categoryId: "ele", optionId: "avanzado" }],
		});

		const stored = await getResourceById(db, created.id);
		expect(stored?.educationalAreas).toEqual([
			{ categoryId: "ele", optionId: "avanzado" },
		]);
	});

	test("actualizar otro campo no borra la categorización", async () => {
		const created = await published(db, "Conservar", {
			educationalAreas: [{ categoryId: "educacion-especial", optionId: null }],
		});
		await updateResource(db, created.id, { title: "Conservar título" });
		const stored = await getResourceById(db, created.id);
		expect(stored?.educationalAreas).toEqual([
			{ categoryId: "educacion-especial", optionId: null },
		]);
	});

	test("si falla el reemplazo de áreas no se guarda el resto de la edición", async () => {
		const created = await published(db, "Título original");
		await pglite.exec("DROP TABLE resource_educational_areas");
		await expect(
			updateResource(db, created.id, {
				title: "Título nuevo",
				educationalAreas: [{ categoryId: "bachillerato", optionId: null }],
			}),
		).rejects.toThrow();
		const [row] = await db
			.select({ title: schema.resources.title })
			.from(schema.resources)
			.where(eq(schema.resources.id, created.id));
		expect(row?.title).toBe("Título original");
	});

	test("el esquema Drizzle declara los mismos índices que la migración", () => {
		expect(
			getTableConfig(schema.resourceEducationalAreas)
				.indexes.map((index) => index.config.name)
				.sort(),
		).toEqual([
			"resource_educational_areas_category_only_uidx",
			"resource_educational_areas_lookup_idx",
			"resource_educational_areas_option_uidx",
		]);
	});

	test("rechaza combinación inexistente y duplicados antes de escribir", async () => {
		await expect(
			published(db, "Inválido", {
				educationalAreas: [{ categoryId: "bachillerato", optionId: "basico" }],
			}),
		).rejects.toBeInstanceOf(EducationalAreaValidationError);

		const rows = await db.select().from(schema.resources);
		expect(rows).toHaveLength(0);

		const created = await published(db, "Válido", {
			educationalAreas: [{ categoryId: "ele", optionId: "basico" }],
		});
		await expect(
			updateResource(db, created.id, {
				educationalAreas: [
					{ categoryId: "ele", optionId: "basico" },
					{ categoryId: "ele", optionId: "basico" },
				],
			}),
		).rejects.toBeInstanceOf(EducationalAreaValidationError);
		const stored = await getResourceById(db, created.id);
		expect(stored?.educationalAreas).toEqual([
			{ categoryId: "ele", optionId: "basico" },
		]);
	});

	test("el índice único impide duplicar la misma asociación", async () => {
		const created = await published(db, "Único");
		const insertArea = (categoryId: string, optionId: string | null) =>
			db.insert(schema.resourceEducationalAreas).values({
				resourceId: created.id,
				categoryId,
				optionId,
			});
		await insertArea("bachillerato", null);
		await expect(
			(async () => {
				await insertArea("bachillerato", null);
			})(),
		).rejects.toThrow();
		await insertArea("ele", "medio");
		await expect(
			(async () => {
				await insertArea("ele", "medio");
			})(),
		).rejects.toThrow();
	});

	test("filtrar por categoría incluye con y sin opción, y por opción solo la combinación, sin duplicar", async () => {
		const both = await published(db, "Régimen con dos opciones", {
			educationalAreas: [
				{ categoryId: "ensenanzas-regimen-especial", optionId: "musica" },
				{ categoryId: "ensenanzas-regimen-especial", optionId: "danza" },
			],
		});
		const onlyCategory = await published(db, "Régimen sin opción", {
			educationalAreas: [
				{ categoryId: "ensenanzas-regimen-especial", optionId: null },
			],
		});
		const ele = await published(db, "ELE avanzado", {
			language: "en",
			educationalAreas: [{ categoryId: "ele", optionId: "avanzado" }],
		});
		const primaria = await published(db, "Primaria concreto", {
			educationalAreas: [
				{ categoryId: "educacion-primaria", optionId: "segundo-tramo" },
			],
		});

		const byCategory = await listResources(db, {
			educationalCategory: "ensenanzas-regimen-especial",
			status: "published",
		});
		const categoryIds = byCategory.data.map((row) => row.id);
		expect(categoryIds.filter((id) => id === both.id)).toEqual([both.id]);
		expect(categoryIds).toContain(onlyCategory.id);
		expect(categoryIds).not.toContain(ele.id);
		expect(byCategory.total).toBe(2);

		const byMusic = await listResources(db, {
			educationalCategory: "ensenanzas-regimen-especial",
			educationalOption: "musica",
			status: "published",
		});
		expect(byMusic.data.map((row) => row.id)).toEqual([both.id]);

		const byPdc = await listResources(db, {
			educationalCategory: "pdc",
			educationalOption: "ambito-linguistico-social",
			status: "published",
		});
		expect(byPdc.total).toBe(0);

		const byEleAndLanguage = await listResources(db, {
			educationalCategory: "ele",
			educationalOption: "avanzado",
			language: "en",
			status: "published",
		});
		expect(byEleAndLanguage.data.map((row) => row.id)).toEqual([ele.id]);

		const eleInSpanish = await listResources(db, {
			educationalCategory: "ele",
			language: "es",
			status: "published",
		});
		expect(eleInSpanish.total).toBe(0);

		const primariaOption = await listResources(db, {
			educationalCategory: "educacion-primaria",
			educationalOption: "primer-tramo",
			status: "published",
		});
		expect(primariaOption.data.map((row) => row.id)).not.toContain(primaria.id);

		const untouched = await db
			.select()
			.from(schema.resourceLevels)
			.where(eq(schema.resourceLevels.resourceId, both.id));
		expect(untouched).toEqual([]);
	});
});
