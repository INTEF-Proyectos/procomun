import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mapLegacyItinerary } from "@procomun/db/legacy-import";
import {
	type loadImportLegacyItinerariesDependencies,
	parseImportLegacyItinerariesArgs,
	runImportLegacyItineraries,
	runImportLegacyItinerariesCommand,
} from "./import-legacy-itineraries.ts";

type Deps = Awaited<ReturnType<typeof loadImportLegacyItinerariesDependencies>>;

function buildDeps(overrides: Partial<Deps> = {}): Deps {
	return {
		getDb: () => ({
			db: {} as ReturnType<Deps["getDb"]>["db"],
			provider: "pg",
		}),
		waitForDb: async () => {},
		mapLegacyItinerary,
		ensureLegacyImportSystemUser: async () => null,
		findLegacyCollectionOwnerAccount: async () => null,
		importLegacyCollection: async () => ({
			outcome: "created",
			collectionId: "c-1",
			owner: "system",
			linkedResources: 0,
			missingResources: [],
		}),
		LEGACY_USER_ID_PREFIX: "legacy-procomun:user:",
		...overrides,
	} as Deps;
}

describe("parseImportLegacyItinerariesArgs", () => {
	test("exige --source-file y valida --limit y --only", () => {
		expect(() => parseImportLegacyItinerariesArgs([])).toThrow(
			"Falta --source-file",
		);
		expect(() =>
			parseImportLegacyItinerariesArgs([
				"--source-file",
				"x.json",
				"--limit",
				"0",
			]),
		).toThrow("--limit inválido");
		expect(() =>
			parseImportLegacyItinerariesArgs([
				"--source-file",
				"x.json",
				"--only",
				" ",
			]),
		).toThrow("--only necesita");
		const options = parseImportLegacyItinerariesArgs([
			"--source-file",
			"x.json",
			"--dry-run",
			"--limit",
			"3",
			"--only",
			"abc",
			"--report-dir",
			"informes",
		]);
		expect(options).toMatchObject({
			dryRun: true,
			limit: 3,
			only: "abc",
			sourceFile: path.resolve("x.json"),
			reportDir: path.resolve("informes"),
		});
	});
});

describe("runImportLegacyItineraries", () => {
	let dir: string;
	let spies: Array<{ mockRestore: () => void }>;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "legacy-itineraries-unit-"));
		spies = [
			spyOn(console, "log").mockImplementation(() => {}),
			spyOn(console, "warn").mockImplementation(() => {}),
			spyOn(console, "error").mockImplementation(() => {}),
		];
	});

	afterEach(() => {
		for (const spy of spies) spy.mockRestore();
	});

	async function source(records: unknown): Promise<string> {
		const file = path.join(dir, "itinerarios.json");
		await writeFile(file, JSON.stringify(records));
		return file;
	}

	test("rechaza un JSON que no es un array", async () => {
		await expect(
			runImportLegacyItineraries(
				{ sourceFile: await source({}), dryRun: true },
				buildDeps(),
			),
		).rejects.toThrow("debe contener un array");
	});

	test("bloquea los registros sin id, sin título o que no son objetos, y sale con 1", async () => {
		let imported = 0;
		const deps = buildDeps({
			importLegacyCollection: async () => {
				imported++;
				return {
					outcome: "would_create",
					collectionId: null,
					owner: "system",
					linkedResources: 0,
					missingResources: [],
				};
			},
		});
		const sourceFile = await source([
			null,
			{ titleStr: "Sin id" },
			{ id: "it-sin-titulo" },
			{ id: "it-ok", titleStr: "Bien", descriptionStr: "x" },
		]);
		const report = await runImportLegacyItineraries(
			{ sourceFile, dryRun: true },
			deps,
		);
		expect(imported).toBe(1);
		expect(report.totals).toMatchObject({ blocked: 3, wouldCreate: 1 });
		expect(report.records.slice(0, 3)).toEqual([
			{ outcome: "blocked", index: 0, errors: ["El registro no es un objeto"] },
			{
				outcome: "blocked",
				index: 1,
				errors: [
					"Falta id: no se puede identificar ni deduplicar el itinerario",
				],
			},
			{
				outcome: "blocked",
				index: 2,
				itineraryId: "it-sin-titulo",
				errors: ["Falta titleStr"],
			},
		]);

		const reportDir = path.join(dir, "informes");
		const exitCode = await runImportLegacyItinerariesCommand(
			{
				...parseImportLegacyItinerariesArgs(["--source-file", sourceFile]),
				dryRun: true,
				reportDir,
			},
			deps,
		);
		expect(exitCode).toBe(1);
		expect(await readdir(reportDir)).toEqual([
			expect.stringMatching(/^informe_itinerarios-dryrun-.+\.json$/),
		]);
	});

	test("busca cada correo una sola vez y en seco no crea el usuario de sistema", async () => {
		const lookups: string[] = [];
		let systemUser = 0;
		const deps = buildDeps({
			ensureLegacyImportSystemUser: async () => {
				systemUser++;
				return null;
			},
			findLegacyCollectionOwnerAccount: async (_db, email) => {
				lookups.push(email);
				return { id: "u-1", deleted: false, emailVerified: true };
			},
		});
		const sourceFile = await source([
			{ id: "a", titleStr: "A", publicatorEmailStr: "Misma@Ejemplo.test" },
			{ id: "b", titleStr: "B", publicatorEmailStr: "misma@ejemplo.test " },
		]);
		await runImportLegacyItineraries({ sourceFile, dryRun: true }, deps);
		expect(lookups).toEqual(["misma@ejemplo.test"]);
		expect(systemUser).toBe(0);

		await runImportLegacyItineraries({ sourceFile, dryRun: false }, deps);
		expect(systemUser).toBe(1);
	});

	test("un error que no es de la base de datos no copia su mensaje", async () => {
		const deps = buildDeps({
			importLegacyCollection: async () => {
				throw new Error("autora@ejemplo.test no cabe");
			},
		});
		const report = await runImportLegacyItineraries(
			{
				sourceFile: await source([{ id: "a", titleStr: "A" }]),
				dryRun: false,
			},
			deps,
		);
		expect(report.totals.errored).toBe(1);
		expect(JSON.stringify(report)).not.toContain("autora@");
	});
});
