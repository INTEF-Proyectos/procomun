import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createResource, updateResource } from "@procomun/db/repository";
import * as schema from "@procomun/db/schema";
import { createTables } from "@procomun/db/setup";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import {
	extractTextFromFile,
	isSupportedForExtraction,
	normalizeText,
	stripHtml,
} from "./extract.ts";
import {
	markExtractionPending,
	markExtractionProcessing,
	reindexAllResources,
	reindexResource,
	resetUnaccentCache,
	saveExtractionResult,
	searchResources,
	updateSearchVector,
} from "./search.ts";

describe("Text Extraction", () => {
	let tempDir: string;

	beforeAll(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "fts-test-"));
	});

	afterAll(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	test("isSupportedForExtraction returns true for supported types", () => {
		expect(isSupportedForExtraction("doc.txt")).toBe(true);
		expect(isSupportedForExtraction("doc.md")).toBe(true);
		expect(isSupportedForExtraction("doc.html")).toBe(true);
		expect(isSupportedForExtraction("doc.htm")).toBe(true);
		expect(isSupportedForExtraction("doc.csv")).toBe(true);
		expect(isSupportedForExtraction("doc.pdf")).toBe(true);
		expect(isSupportedForExtraction("doc.docx")).toBe(true);
	});

	test("isSupportedForExtraction returns false for unsupported types", () => {
		expect(isSupportedForExtraction("image.png")).toBe(false);
		expect(isSupportedForExtraction("video.mp4")).toBe(false);
		expect(isSupportedForExtraction("archive.zip")).toBe(false);
		expect(isSupportedForExtraction("noextension")).toBe(false);
	});

	test("extractTextFromFile extracts TXT correctly", async () => {
		const file = join(tempDir, "test.txt");
		await writeFile(file, "Hello world from plain text");
		const result = await extractTextFromFile(file, "test.txt");
		expect(result.text).toBe("Hello world from plain text");
		expect(result.skipped).toBeUndefined();
		expect(result.error).toBeUndefined();
	});

	test("extractTextFromFile extracts MD correctly", async () => {
		const file = join(tempDir, "test.md");
		await writeFile(file, "# Title\n\nSome **markdown** content");
		const result = await extractTextFromFile(file, "test.md");
		expect(result.text).toContain("Title");
		expect(result.text).toContain("markdown");
		expect(result.text).toContain("content");
	});

	test("extractTextFromFile strips HTML tags", async () => {
		const file = join(tempDir, "test.html");
		await writeFile(
			file,
			"<html><body><h1>Title</h1><p>Paragraph</p><script>var x=1;</script></body></html>",
		);
		const result = await extractTextFromFile(file, "test.html");
		expect(result.text).toContain("Title");
		expect(result.text).toContain("Paragraph");
		expect(result.text).not.toContain("<h1>");
		expect(result.text).not.toContain("var x=1");
	});

	test("extractTextFromFile extracts CSV correctly", async () => {
		const file = join(tempDir, "test.csv");
		await writeFile(file, "name,age\nAlice,30\nBob,25");
		const result = await extractTextFromFile(file, "test.csv");
		expect(result.text).toContain("Alice");
		expect(result.text).toContain("Bob");
	});

	test("extractTextFromFile handles PDF extraction errors gracefully", async () => {
		const file = join(tempDir, "bad.pdf");
		await writeFile(file, "not a real pdf content");
		const result = await extractTextFromFile(file, "bad.pdf");
		// pdf-parse may throw on invalid PDF or return empty text
		expect(result.text !== undefined || result.error !== undefined).toBe(true);
	});

	test("extractTextFromFile handles DOCX extraction errors gracefully", async () => {
		const file = join(tempDir, "bad.docx");
		await writeFile(file, "not a real docx content");
		const result = await extractTextFromFile(file, "bad.docx");
		// mammoth may throw on invalid DOCX or return empty text
		expect(result.text !== undefined || result.error !== undefined).toBe(true);
	});

	test("extractTextFromFile handles .htm extension", async () => {
		const file = join(tempDir, "page.htm");
		await writeFile(file, "<html><body><p>HTM content</p></body></html>");
		const result = await extractTextFromFile(file, "page.htm");
		expect(result.text).toContain("HTM content");
	});

	test("extractTextFromFile marks unsupported files as skipped", async () => {
		const file = join(tempDir, "image.png");
		await writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
		const result = await extractTextFromFile(file, "image.png");
		expect(result.skipped).toBe(true);
		expect(result.text).toBe("");
	});

	test("extractTextFromFile handles missing files gracefully", async () => {
		const result = await extractTextFromFile(
			"/nonexistent/path.txt",
			"path.txt",
		);
		expect(result.error).toBeDefined();
		expect(result.text).toBe("");
	});

	test("normalizeText compacts whitespace", () => {
		const input = "Hello    world\n\n\n\n\ntest";
		const result = normalizeText(input);
		expect(result).toBe("Hello world\n\ntest");
	});

	test("normalizeText removes control characters", () => {
		const input = "Hello\x00\x01World";
		const result = normalizeText(input);
		expect(result).toBe("HelloWorld");
	});

	test("normalizeText truncates to max size", () => {
		const largeText = "a".repeat(600 * 1024);
		const result = normalizeText(largeText);
		expect(Buffer.byteLength(result, "utf-8")).toBeLessThanOrEqual(500 * 1024);
	});

	test("stripHtml removes script and style elements", () => {
		const html =
			"<p>Content</p><script>alert(1)</script><style>.x{}</style><p>More</p>";
		const result = stripHtml(html);
		expect(result).toContain("Content");
		expect(result).toContain("More");
		expect(result).not.toContain("alert");
		expect(result).not.toContain(".x{}");
	});
});

describe("FTS Search & Indexing", () => {
	let db: ReturnType<typeof drizzle>;
	let pglite: PGlite;

	beforeAll(async () => {
		pglite = new PGlite();
		await createTables(pglite);
		db = drizzle(pglite, { schema });

		// Create test resources
		await createResource(db as any, {
			title: "Matemáticas avanzadas",
			description: "Curso completo de álgebra y cálculo diferencial",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			keywords: "matemáticas, álgebra, cálculo",
		});

		await createResource(db as any, {
			title: "English Grammar",
			description: "A complete guide to English grammar rules",
			language: "en",
			license: "cc-by-sa",
			resourceType: "documento",
			keywords: "english, grammar, language",
		});

		await createResource(db as any, {
			title: "Educación física",
			description: "Ejercicios para educación primaria",
			language: "es",
			license: "cc-by",
			resourceType: "video",
			keywords: "deporte, salud",
		});

		// Publish all resources for searching
		const rawResources = await db.execute(sql`SELECT id FROM resources`);
		const allResources = (rawResources.rows ?? rawResources) as unknown as {
			id: string;
		}[];
		for (const r of allResources) {
			await db.execute(
				sql`UPDATE resources SET editorial_status = 'published' WHERE id = ${r.id}`,
			);
		}

		// Save extracted text for the first resource
		const first = allResources[0];
		if (first) {
			await saveExtractionResult(db as any, first.id, {
				text: "Este documento trata sobre números primos y ecuaciones cuadráticas",
				status: "completed",
			});
		}

		// Update search vectors for all
		for (const r of allResources) {
			await updateSearchVector(db as any, r.id);
		}
	});

	afterAll(async () => {
		await pglite.close();
	});

	test("search by title finds resource", async () => {
		const result = await searchResources(db as any, {
			query: "matemáticas",
			language: "es",
			status: "published",
		});
		expect(result.data.length).toBeGreaterThan(0);
		expect(result.data.some((r) => r.title === "Matemáticas avanzadas")).toBe(
			true,
		);
	});

	test("search by description finds resource", async () => {
		const result = await searchResources(db as any, {
			query: "álgebra",
			language: "es",
			status: "published",
		});
		expect(result.data.length).toBeGreaterThan(0);
		expect(result.data.some((r) => r.title === "Matemáticas avanzadas")).toBe(
			true,
		);
	});

	test("search by extracted text finds resource", async () => {
		const result = await searchResources(db as any, {
			query: "ecuaciones cuadráticas",
			language: "es",
			status: "published",
		});
		expect(result.data.length).toBeGreaterThan(0);
		expect(result.data.some((r) => r.title === "Matemáticas avanzadas")).toBe(
			true,
		);
	});

	test("title match ranks higher than content match", async () => {
		const result = await searchResources(db as any, {
			query: "educación",
			language: "es",
			status: "published",
		});
		expect(result.data.length).toBeGreaterThan(0);
		// "Educación física" has the term in title (weight A)
		// "Educación primaria" is in description of the same resource
		const titleMatch = result.data.find((r) => r.title === "Educación física");
		expect(titleMatch).toBeDefined();
		if (result.data.length > 1 && result.data[0]) {
			// If multiple results, title match should be first
			expect(result.data[0].title).toBe("Educación física");
		}
	});

	test("search with pagination", async () => {
		const result = await searchResources(db as any, {
			query: "educación OR matemáticas OR grammar",
			language: "es",
			status: "published",
			limit: 1,
			offset: 0,
		});
		expect(result.data.length).toBeLessThanOrEqual(1);
		expect(result.total).toBeGreaterThanOrEqual(1);
	});

	test("search returns total count", async () => {
		const result = await searchResources(db as any, {
			query: "matemáticas",
			language: "es",
			status: "published",
		});
		expect(result.total).toBeGreaterThan(0);
	});

	test("search does not return deleted resources", async () => {
		// Create and soft-delete a resource
		const { id } = await createResource(db as any, {
			title: "Recurso eliminado con búsqueda especial",
			description: "Este recurso fue eliminado",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
		});
		await db.execute(
			sql`UPDATE resources SET editorial_status = 'published', deleted_at = NOW() WHERE id = ${id}`,
		);
		await updateSearchVector(db as any, id);

		const result = await searchResources(db as any, {
			query: "búsqueda especial",
			language: "es",
			status: "published",
		});
		expect(result.data.some((r) => r.id === id)).toBe(false);
	});

	test("search does not return draft resources", async () => {
		const { id } = await createResource(db as any, {
			title: "Borrador con término único xyzborrador",
			description: "Este es un borrador",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
		});
		await updateSearchVector(db as any, id);

		const result = await searchResources(db as any, {
			query: "xyzborrador",
			language: "es",
			status: "published",
		});
		expect(result.data.some((r) => r.id === id)).toBe(false);
	});

	test("reindexResource updates vector", async () => {
		const { id } = await createResource(db as any, {
			title: "Reindex test original",
			description: "Original description",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
		});
		await db.execute(
			sql`UPDATE resources SET editorial_status = 'published' WHERE id = ${id}`,
		);
		await updateSearchVector(db as any, id);

		// Update title
		await updateResource(db as any, id, {
			title: "Reindex test actualizado terminounico42",
		});
		await reindexResource(db as any, id);

		const result = await searchResources(db as any, {
			query: "terminounico42",
			language: "es",
			status: "published",
		});
		expect(result.data.some((r) => r.id === id)).toBe(true);
	});

	test("reindexAllResources processes all resources", async () => {
		const result = await reindexAllResources(db as any);
		expect(result.processed).toBeGreaterThan(0);
	});

	test("search vector updates when extraction result is saved", async () => {
		const { id } = await createResource(db as any, {
			title: "Recurso para extracción",
			description: "Test extraction",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
		});
		await db.execute(
			sql`UPDATE resources SET editorial_status = 'published' WHERE id = ${id}`,
		);

		await saveExtractionResult(db as any, id, {
			text: "contenido extraído único fotosíntesis clorofila",
			status: "completed",
		});

		const result = await searchResources(db as any, {
			query: "fotosíntesis",
			language: "es",
			status: "published",
		});
		expect(result.data.some((r) => r.id === id)).toBe(true);
	});

	test("markExtractionPending sets extraction status to pending", async () => {
		const { id } = await createResource(db as any, {
			title: "Pending extraction test",
			description: "Test pending status",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
		});

		await markExtractionPending(db as any, id);

		const rows = await db.execute(
			sql`SELECT extraction_status FROM resources WHERE id = ${id}`,
		);
		const result = (rows.rows ?? rows) as unknown as {
			extraction_status: string;
		}[];
		expect(result[0]?.extraction_status).toBe("pending");
	});

	test("markExtractionProcessing sets extraction status to processing", async () => {
		const { id } = await createResource(db as any, {
			title: "Processing extraction test",
			description: "Test processing status",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
		});

		await markExtractionProcessing(db as any, id);

		const rows = await db.execute(
			sql`SELECT extraction_status FROM resources WHERE id = ${id}`,
		);
		const result = (rows.rows ?? rows) as unknown as {
			extraction_status: string;
		}[];
		expect(result[0]?.extraction_status).toBe("processing");
	});

	test("resetUnaccentCache resets the unaccent availability cache", async () => {
		// Just verifying it doesn't throw and subsequent calls still work
		resetUnaccentCache();
		// After reset, updateSearchVector should still work (re-detects unaccent)
		const { id } = await createResource(db as any, {
			title: "Reset cache test",
			description: "Testing cache reset",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
		});
		await updateSearchVector(db as any, id);
		resetUnaccentCache(); // cleanup
	});

	test("saveExtractionResult with error status stores error message", async () => {
		const { id } = await createResource(db as any, {
			title: "Error extraction test",
			description: "Test error status",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
		});

		await saveExtractionResult(db as any, id, {
			text: "",
			status: "error",
			error: "File corrupted",
		});

		const rows = await db.execute(
			sql`SELECT extraction_status, extraction_error FROM resources WHERE id = ${id}`,
		);
		const result = (rows.rows ?? rows) as unknown as {
			extraction_status: string;
			extraction_error: string;
		}[];
		expect(result[0]?.extraction_status).toBe("error");
		expect(result[0]?.extraction_error).toBe("File corrupted");
	});

	test("saveExtractionResult with skipped status", async () => {
		const { id } = await createResource(db as any, {
			title: "Skipped extraction test",
			description: "Test skipped status",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
		});

		await saveExtractionResult(db as any, id, {
			text: "",
			status: "skipped",
		});

		const rows = await db.execute(
			sql`SELECT extraction_status, extracted_at FROM resources WHERE id = ${id}`,
		);
		const result = (rows.rows ?? rows) as unknown as {
			extraction_status: string;
			extracted_at: string | null;
		}[];
		expect(result[0]?.extraction_status).toBe("skipped");
		expect(result[0]?.extracted_at).toBeNull();
	});

	test("search with English language config", async () => {
		const { id } = await createResource(db as any, {
			title: "English language resource",
			description: "A comprehensive English tutorial",
			language: "en",
			license: "cc-by",
			resourceType: "documento",
		});
		await db.execute(
			sql`UPDATE resources SET editorial_status = 'published' WHERE id = ${id}`,
		);
		await updateSearchVector(db as any, id);

		const result = await searchResources(db as any, {
			query: "comprehensive tutorial",
			language: "en",
			status: "published",
		});
		expect(result.data.some((r) => r.id === id)).toBe(true);
	});

	test("search with empty query returns empty results", async () => {
		const result = await searchResources(db as any, {
			query: "zzzznonexistentterm99999",
			language: "es",
			status: "published",
		});
		expect(result.data.length).toBe(0);
		expect(result.total).toBe(0);
	});
});
