import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
	crossKeywordCatalogWithAreas,
	type DrizzleDB,
	listKeywordCatalog,
	retireCatalogKeywords,
} from "@procomun/db/repository";
import * as schema from "@procomun/db/schema";
import { createTables } from "@procomun/db/setup";
import { drizzle } from "drizzle-orm/pglite";
import {
	type CatalogAreaKeywordsReport,
	parseCatalogAreaKeywordsArgs,
	runCatalogAreaKeywords,
} from "./catalog-area-keywords.ts";

describe("catalog:area-keywords (#448)", () => {
	let db: DrizzleDB;
	let reportDir: string;
	const deps = { crossKeywordCatalogWithAreas, retireCatalogKeywords };

	beforeEach(async () => {
		const client = new PGlite();
		await createTables(client);
		db = drizzle(client, { schema }) as unknown as DrizzleDB;
		reportDir = await mkdtemp(path.join(tmpdir(), "cruce-areas-"));
	});

	afterEach(async () => {
		await rm(reportDir, { recursive: true, force: true });
	});

	async function readReport(): Promise<CatalogAreaKeywordsReport> {
		const [file] = await readdir(reportDir);
		return JSON.parse(await readFile(path.join(reportDir, file ?? ""), "utf8"));
	}

	test("por defecto es una prueba en seco: informa y no retira nada", async () => {
		const before = (await listKeywordCatalog(db)).length;
		const report = await runCatalogAreaKeywords(
			["--report-dir", reportDir],
			deps,
			db,
		);
		expect(report.dryRun).toBe(true);
		expect(report.retired).toEqual([]);
		expect(report.toRetire).toEqual(
			expect.arrayContaining(["biologia", "quimica"]),
		);
		expect(report.toRetire).not.toContain("informatica");
		expect(report.totals.review).toBeGreaterThan(0);
		expect((await listKeywordCatalog(db)).length).toBe(before);
		const [file] = await readdir(reportDir);
		expect(file).toStartWith("cruce_palabras_clave_areas-dryrun-");
		expect((await readReport()).crossing.keep.map((item) => item.id)).toContain(
			"geometria",
		);
	});

	test("--apply retira las idénticas y las de --include revisadas", async () => {
		const report = await runCatalogAreaKeywords(
			["--apply", "--include", "informatica", "--report-dir", reportDir],
			deps,
			db,
		);
		expect(report.dryRun).toBe(false);
		expect(report.retired).toEqual(
			expect.arrayContaining(["biologia", "informatica"]),
		);
		const selectable = (await listKeywordCatalog(db)).map((item) => item.id);
		expect(selectable).not.toContain("biologia");
		expect(selectable).not.toContain("informatica");
		expect(selectable).toContain("geometria");

		// Repetirlo no vuelve a retirar nada.
		const again = await runCatalogAreaKeywords(
			["--apply", "--report-dir", reportDir],
			deps,
			db,
		);
		expect(again.retired).toEqual([]);
	});

	test("--include rechaza ids que no están en el cruce", async () => {
		await expect(
			runCatalogAreaKeywords(
				["--apply", "--include", "geometria", "--report-dir", reportDir],
				deps,
				db,
			),
		).rejects.toThrow("--include solo admite");
		expect((await listKeywordCatalog(db)).map((item) => item.id)).toContain(
			"biologia",
		);
	});

	test("lee los argumentos", () => {
		expect(
			parseCatalogAreaKeywordsArgs([
				"--include",
				" a , b ,",
				"--report-dir",
				"/tmp/x",
			]),
		).toEqual({ apply: false, include: ["a", "b"], reportDir: "/tmp/x" });
	});
});
