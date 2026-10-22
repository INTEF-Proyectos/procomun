import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import {
	backfillLegacyEducationalAreas,
	createResource,
	ensureUser,
	getResourceById,
	importLegacyResourceWithElpx,
	listResources,
	updateResource,
} from "../repository.ts";
import * as schema from "../schema/index.ts";
import { createTables } from "../setup.ts";
import type { DrizzleDB } from "./shared.ts";

function legacyInput(
	levels: string[],
	externalId = "es_cat_1",
	language = "es",
) {
	return {
		resource: {
			externalId,
			importSource: "legacy-procomun",
			sourceUri: null,
			title: "Recurso legacy",
			description: "Descripción",
			language,
			license: "cc-by",
			resourceType: "proyecto",
			subjects: ["Matemáticas"],
			levels,
			author: null,
			publisher: null,
			keywords: null,
			previewImageUrl: null,
			importedAt: new Date("2020-01-02T00:00:00.000Z"),
		},
		elpx: {
			hash: `hash-${externalId}`,
			extractPath: `/tmp/${externalId}`,
			originalFilename: "recurso.elpx",
			hasPreview: false,
			elpxMetadata: null,
		},
		media: {
			uploadId: crypto.randomUUID(),
			ownerId: "legacy-import-system-user",
			fileSize: 10,
			mimeType: "application/zip",
			url: "/api/v1/uploads/x/content",
			storageKey: `legacy/${externalId}`,
			finalChecksum: `sum-${externalId}`,
		},
	};
}

describe("importación legacy de categorización educativa", () => {
	let db: DrizzleDB;
	let pglite: PGlite;

	beforeEach(async () => {
		pglite = new PGlite();
		await createTables(pglite);
		db = drizzle(pglite, { schema });
		await ensureUser(db, {
			id: "legacy-import-system-user",
			email: "legacy-import@system.local",
			role: "admin",
		});
	});

	afterEach(async () => {
		await pglite.close();
	});

	test("aplica la correspondencia, conserva el texto original y no asigna lo desconocido", async () => {
		const input = legacyInput([
			"Educación Primaria",
			"10 - 11 años / Quinto curso",
			"Enseñanza oficial de idiomas",
			"Nivel básico (A)",
			"Taller inventado",
		]);
		const created = await importLegacyResourceWithElpx(db, input);
		const stored = await getResourceById(db, created.resourceId);
		expect(stored?.educationalAreas).toEqual([
			{ categoryId: "educacion-primaria", optionId: "tercer-ciclo" },
			{ categoryId: "ele", optionId: "basico" },
			{ categoryId: "ensenanzas-regimen-especial", optionId: "idiomas" },
		]);
		const levels = await db
			.select()
			.from(schema.resourceLevels)
			.where(eq(schema.resourceLevels.resourceId, created.resourceId));
		expect(levels.map((row) => row.level)).toEqual(input.resource.levels);

		const byCiclo = await listResources(db, {
			status: "published",
			educationalCategory: "educacion-primaria",
			educationalOption: "tercer-ciclo",
		});
		expect(byCiclo.data.map((row) => row.id)).toEqual([created.resourceId]);
		const byOther = await listResources(db, {
			status: "published",
			educationalCategory: "educacion-primaria",
			educationalOption: "primer-ciclo",
		});
		expect(byOther.data).toHaveLength(0);
		const pdc = await listResources(db, {
			status: "published",
			educationalCategory: "pdc",
		});
		expect(pdc.total).toBe(0);
	});

	test("A/B/C solo son ELE en un recurso en español, también en el relleno (#383)", async () => {
		const english = await importLegacyResourceWithElpx(
			db,
			legacyInput(["Bachillerato", "Nivel intermedio (B)"], "en_b", "en"),
		);
		expect(
			(await getResourceById(db, english.resourceId))?.educationalAreas,
		).toEqual([{ categoryId: "bachillerato", optionId: null }]);

		await db.delete(schema.resourceEducationalAreas);
		await backfillLegacyEducationalAreas(db, { dryRun: false });
		expect(
			(await getResourceById(db, english.resourceId))?.educationalAreas,
		).toEqual([{ categoryId: "bachillerato", optionId: null }]);
	});

	test("sin categorías de origen no inventa una clasificación", async () => {
		const created = await importLegacyResourceWithElpx(
			db,
			legacyInput([], "es_vacio"),
		);
		const stored = await getResourceById(db, created.resourceId);
		expect(stored?.educationalAreas).toEqual([]);
	});

	test("reimportar el mismo externalId no duplica la asociación", async () => {
		const input = legacyInput(["Bachillerato"], "es_bach");
		await importLegacyResourceWithElpx(db, input);
		await expect(importLegacyResourceWithElpx(db, input)).rejects.toThrow();
		const rows = await db.select().from(schema.resourceEducationalAreas);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.optionId).toBeNull();
	});

	test("el relleno clasifica lo importado antes, en seco no escribe y repetirlo no cambia nada", async () => {
		const primaria = await importLegacyResourceWithElpx(
			db,
			legacyInput(["6 -7 años / Primer curso", "Taller inventado"], "es_a"),
		);
		const fp = await importLegacyResourceWithElpx(
			db,
			legacyInput(["Formación Profesional"], "es_b"),
		);
		await importLegacyResourceWithElpx(db, legacyInput([], "es_c"));
		// Simula recursos importados antes de la correspondencia.
		await db.delete(schema.resourceEducationalAreas);
		// Uno ya clasificado a mano no se toca.
		await updateResource(db, fp.resourceId, {
			educationalAreas: [{ categoryId: "bachillerato", optionId: null }],
		});
		// Un recurso que no es legacy tampoco.
		await createResource(db, {
			title: "Propio",
			description: "Recurso propio",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			levels: ["Bachillerato"],
		});

		const expectedNotes = [
			{
				externalId: "es_a",
				sourceCategories: ["6 -7 años / Primer curso", "Taller inventado"],
				language: "es",
			},
			{ externalId: "es_c", sourceCategories: [], language: "es" },
		];
		expect(await backfillLegacyEducationalAreas(db, { dryRun: true })).toEqual(
			expectedNotes,
		);
		expect(
			await db.select().from(schema.resourceEducationalAreas),
		).toHaveLength(1);

		expect(await backfillLegacyEducationalAreas(db, { dryRun: false })).toEqual(
			expectedNotes,
		);
		expect(
			(await getResourceById(db, primaria.resourceId))?.educationalAreas,
		).toEqual([{ categoryId: "educacion-primaria", optionId: "primer-ciclo" }]);
		expect(
			(await getResourceById(db, fp.resourceId))?.educationalAreas,
		).toEqual([{ categoryId: "bachillerato", optionId: null }]);

		const before = await db.select().from(schema.resourceEducationalAreas);
		expect(await backfillLegacyEducationalAreas(db, { dryRun: false })).toEqual(
			[{ externalId: "es_c", sourceCategories: [], language: "es" }],
		);
		expect(await db.select().from(schema.resourceEducationalAreas)).toEqual(
			before,
		);
	});
});
