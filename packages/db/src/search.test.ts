import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { createResource, listResources } from "./repository.ts";
import * as schema from "./schema/resources.ts";
import { createTables } from "./setup.ts";

type TestDatabase = Parameters<typeof createResource>[0];

describe("Search Case and Accent Insensitivity", () => {
	let db: TestDatabase;
	let pglite: PGlite;

	beforeAll(async () => {
		pglite = new PGlite();
		await createTables(pglite);
		// search.test only loads resources schema (not full AppSchema); cast is
		// the narrowest bridge for this focused suite.
		db = drizzle(pglite, { schema }) as unknown as TestDatabase;

		// Seed some data
		await createResource(db, {
			title: "Matemáticas",
			description: "Ciencia de los números",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			author: "García",
			keywords: "educación, mates",
		});

		await createResource(db, {
			title: "Educación Física",
			description: "Deporte en la escuela",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			author: "Pérez",
			keywords: "deporte",
		});
	});

	afterAll(async () => {
		await pglite.close();
	});

	test("Search 'matematicas' should find 'Matemáticas'", async () => {
		const result = await listResources(db, { search: "matematicas" });
		expect(result.data.some((r) => r.title === "Matemáticas")).toBe(true);
	});

	test("Search 'MATEMATICAS' should find 'Matemáticas'", async () => {
		const result = await listResources(db, { search: "MATEMATICAS" });
		expect(result.data.some((r) => r.title === "Matemáticas")).toBe(true);
	});

	test("Search 'educacion' should find 'Educación Física'", async () => {
		const result = await listResources(db, { search: "educacion" });
		expect(result.data.some((r) => r.title === "Educación Física")).toBe(true);
	});

	test("Search 'GARCIA' should find resource by 'García'", async () => {
		const result = await listResources(db, { search: "GARCIA" });
		expect(result.data.some((r) => r.author === "García")).toBe(true);
	});

	test("Search 'escuela' should find resource by description", async () => {
		const result = await listResources(db, { search: "escuela" });
		expect(result.data.some((r) => r.title === "Educación Física")).toBe(true);
	});
});
