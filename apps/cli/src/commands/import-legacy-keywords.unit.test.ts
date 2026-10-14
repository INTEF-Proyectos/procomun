import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LegacyKeywordReport } from "@procomun/db/repository";
import {
	type loadImportLegacyKeywordsDependencies,
	parseImportLegacyKeywordsArgs,
	runImportLegacyKeywords,
} from "./import-legacy-keywords.ts";

type Deps = Awaited<ReturnType<typeof loadImportLegacyKeywordsDependencies>>;

const report: LegacyKeywordReport = {
	dryRun: false,
	totals: {
		resources: 2,
		withMatch: 1,
		coverage: 0.5,
		assigned: 1,
		alreadyAssigned: 0,
		overLimit: 0,
	},
	unmatched: [{ label: "Scratch", resources: 1 }],
	ambiguous: [],
	overLimit: [],
	assigned: [{ resourceId: "r1", added: ["geometria"] }],
};

describe("import:legacy-keywords", () => {
	let dir: string;
	let reindexed: string[];
	let dryRuns: boolean[];
	const deps = {
		getDb: () => ({ db: {}, provider: "pg" }),
		waitForDb: async () => {},
		mapLegacyKeywords: async (_db: unknown, options: { dryRun: boolean }) => {
			dryRuns.push(options.dryRun);
			return { ...report, dryRun: options.dryRun };
		},
		updateSearchVector: async (_db: unknown, id: string) => {
			reindexed.push(id);
		},
	} as unknown as Deps;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "legacy-keywords-"));
		reindexed = [];
		dryRuns = [];
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	test("lee --dry-run y --report-dir, y rechaza opciones desconocidas", () => {
		expect(parseImportLegacyKeywordsArgs([]).dryRun).toBe(false);
		expect(
			parseImportLegacyKeywordsArgs(["--dry-run", "--report-dir", dir]),
		).toEqual({ dryRun: true, reportDir: dir });
		expect(() => parseImportLegacyKeywordsArgs(["--limit", "3"])).toThrow();
	});

	test("en seco escribe el informe y no reindexa", async () => {
		const file = await runImportLegacyKeywords(
			{ dryRun: true, reportDir: dir },
			deps,
		);
		expect(path.basename(file)).toStartWith("informe_palabras_clave-dryrun-");
		expect(JSON.parse(await readFile(file, "utf8")).unmatched).toEqual(
			report.unmatched,
		);
		expect(dryRuns).toEqual([true]);
		expect(reindexed).toEqual([]);
	});

	test("al aplicar reindexa los recursos asignados", async () => {
		await runImportLegacyKeywords({ dryRun: false, reportDir: dir }, deps);
		expect(dryRuns).toEqual([false]);
		expect(reindexed).toEqual(["r1"]);
	});
});
