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
		findLegacyAccountById: async () => null,
		loadLegacyCollectionMetadataCatalog: async () => ({
			areas: new Map(),
			keywords: new Map(),
		}),
		importLegacyCollection: async () => ({
			outcome: "created",
			collectionId: "c-1",
			owner: "system",
			linkedResources: 0,
			missingResources: [],
		}),
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
		expect(() =>
			parseImportLegacyItinerariesArgs(["--source-file", "x.json"]),
		).toThrow("Falta --users-file");
		const options = parseImportLegacyItinerariesArgs([
			"--source-file",
			"x.json",
			"--users-file",
			"usuarios.json",
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
			usersFile: path.resolve("usuarios.json"),
			reportDir: path.resolve("informes"),
		});
	});
});

describe("runImportLegacyItineraries", () => {
	let dir: string;
	let usersFile: string;
	let spies: Array<{ mockRestore: () => void }>;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "legacy-itineraries-unit-"));
		usersFile = path.join(dir, "usuarios.json");
		await Bun.write(
			usersFile,
			JSON.stringify([{ uid: 1, mail: "misma@ejemplo.test" }]),
		);
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
				{ usersFile, sourceFile: await source({}), dryRun: true },
				buildDeps(),
			),
		).rejects.toThrow("debe contener un array");
	});

	test("rechaza un volcado de usuarios sin array antes de conectar a la base", async () => {
		await Bun.write(usersFile, "{}");
		await expect(
			runImportLegacyItineraries(
				{ sourceFile: await source([]), usersFile, dryRun: true },
				buildDeps({
					waitForDb: async () => {
						throw new Error("conexión imprevista");
					},
				}),
			),
		).rejects.toThrow("--users-file debe contener un array de usuarios");
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
			{ sourceFile, usersFile, dryRun: true },
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
				...parseImportLegacyItinerariesArgs([
					"--source-file",
					sourceFile,
					"--users-file",
					usersFile,
				]),
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
			findLegacyAccountById: async (_db, id) => {
				lookups.push(id);
				return { id: "u-1", deleted: false, emailVerified: true };
			},
		});
		const sourceFile = await source([
			{ id: "a", titleStr: "A", publicatorEmailStr: "Misma@Ejemplo.test" },
			{ id: "b", titleStr: "B", publicatorEmailStr: "misma@ejemplo.test " },
		]);
		await runImportLegacyItineraries(
			{ sourceFile, usersFile, dryRun: true },
			deps,
		);
		expect(lookups).toEqual(["legacy-procomun:user:1"]);
		expect(systemUser).toBe(0);

		await runImportLegacyItineraries(
			{ sourceFile, usersFile, dryRun: false },
			deps,
		);
		expect(systemUser).toBe(1);
	});

	test("preserva entidades inválidas y omite valores de origen en el informe", async () => {
		const report = await runImportLegacyItineraries(
			{
				usersFile,
				sourceFile: await source([
					{
						id: "a",
						titleStr: "A",
						descriptionStr: "&#1114112;",
						published: "privado@ejemplo.test",
						publicationDate: "privado@ejemplo.test",
					},
					{ id: "b", titleStr: "B" },
				]),
				dryRun: false,
			},
			buildDeps({
				importLegacyCollection: async (_db, { itinerary }) => {
					if (itinerary.externalId === "a")
						expect(itinerary.description).toBe("&#1114112;");
					return {
						outcome: "created",
						collectionId: itinerary.externalId,
						owner: "system",
						linkedResources: 0,
						missingResources: [],
					};
				},
			}),
		);
		expect(report.totals.created).toBe(2);
		expect(JSON.stringify(report)).not.toContain("privado@ejemplo.test");
	});

	test("continúa el lote si falla el mapeo de un registro", async () => {
		const report = await runImportLegacyItineraries(
			{
				usersFile,
				sourceFile: await source([{ id: "a" }, { id: "b", titleStr: "B" }]),
				dryRun: false,
			},
			buildDeps({
				mapLegacyItinerary: (record) => {
					if (record.id === "a") throw new Error("privado@ejemplo.test");
					return mapLegacyItinerary(record);
				},
			}),
		);
		expect(report.totals.errored).toBe(1);
		expect(report.totals.created).toBe(1);
		expect(JSON.stringify(report)).not.toContain("privado@ejemplo.test");
	});

	test("un error que no es de la base de datos no copia su mensaje", async () => {
		const deps = buildDeps({
			importLegacyCollection: async () => {
				throw new Error("autora@ejemplo.test no cabe");
			},
		});
		const report = await runImportLegacyItineraries(
			{
				usersFile,
				sourceFile: await source([{ id: "a", titleStr: "A" }]),
				dryRun: false,
			},
			deps,
		);
		expect(report.totals.errored).toBe(1);
		expect(JSON.stringify(report)).not.toContain("autora@");
	});
});
