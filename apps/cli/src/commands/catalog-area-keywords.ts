/**
 * Cruza el catálogo de palabras clave (#384) con el de áreas de conocimiento
 * (#448) y, con --apply, retira de las palabras clave los términos que pasan
 * a ser áreas. Sin --apply es una prueba en seco: solo escribe el informe.
 * Retirar no quita nada a los recursos: dejan de ofrecerse para nuevas
 * selecciones (ADR-0045).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import type { KeywordAreaCrossing } from "@procomun/db/repository";
import { closeCliDb } from "./import-legacy-users.ts";

export async function loadCatalogAreaKeywordsDependencies() {
	const [{ getDb, waitForDb }, repo] = await Promise.all([
		import("../../../api/src/db.ts"),
		import("@procomun/db/repository"),
	]);
	return {
		getDb,
		waitForDb,
		crossKeywordCatalogWithAreas: repo.crossKeywordCatalogWithAreas,
		retireCatalogKeywords: repo.retireCatalogKeywords,
	};
}

type Deps = Awaited<ReturnType<typeof loadCatalogAreaKeywordsDependencies>>;

export interface CatalogAreaKeywordsReport {
	runId: string;
	dryRun: boolean;
	generatedAt: string;
	totals: {
		identical: number;
		review: number;
		keep: number;
		retired: number;
	};
	/** Ids que se retiran (o se retirarían en la prueba en seco). */
	toRetire: string[];
	retired: string[];
	crossing: KeywordAreaCrossing;
}

export function parseCatalogAreaKeywordsArgs(args: string[]) {
	const { values } = parseArgs({
		args,
		options: {
			apply: { type: "boolean", default: false },
			include: { type: "string" },
			"report-dir": { type: "string" },
		},
		strict: true,
	});
	return {
		apply: Boolean(values.apply),
		include: (values.include ?? "")
			.split(",")
			.map((id) => id.trim())
			.filter(Boolean),
		reportDir: path.resolve(
			values["report-dir"] ??
				path.join(import.meta.dir, "../../../../local-data/catalog-reports"),
		),
	};
}

/**
 * Términos a retirar: los de denominación idéntica a un área, más los de
 * revisión que se pasen con --include tras revisarlos. Un id de --include
 * que no esté en el cruce es un error: evita retirar algo por despiste.
 */
export function selectKeywordsToRetire(
	crossing: KeywordAreaCrossing,
	include: readonly string[],
): string[] {
	const reviewIds = new Set(crossing.review.map((item) => item.keyword.id));
	const identicalIds = crossing.identical.map((item) => item.keyword.id);
	const unknown = include.filter(
		(id) => !reviewIds.has(id) && !identicalIds.includes(id),
	);
	if (unknown.length > 0) {
		throw new Error(
			`--include solo admite palabras clave del cruce («a revisar»): ${unknown.join(", ")}`,
		);
	}
	return [...new Set([...identicalIds, ...include])];
}

export async function runCatalogAreaKeywords(
	args: string[],
	deps: Pick<Deps, "crossKeywordCatalogWithAreas" | "retireCatalogKeywords">,
	db: Parameters<Deps["crossKeywordCatalogWithAreas"]>[0],
): Promise<CatalogAreaKeywordsReport> {
	const options = parseCatalogAreaKeywordsArgs(args);
	const crossing = await deps.crossKeywordCatalogWithAreas(db);
	const toRetire = selectKeywordsToRetire(crossing, options.include);
	const retired = options.apply
		? await deps.retireCatalogKeywords(db, toRetire)
		: [];
	const report: CatalogAreaKeywordsReport = {
		runId: new Date().toISOString().replace(/[:.]/g, "-"),
		dryRun: !options.apply,
		generatedAt: new Date().toISOString(),
		totals: {
			identical: crossing.identical.length,
			review: crossing.review.length,
			keep: crossing.keep.length,
			retired: retired.length,
		},
		toRetire,
		retired,
		crossing,
	};
	await mkdir(options.reportDir, { recursive: true });
	await writeFile(
		path.join(
			options.reportDir,
			`cruce_palabras_clave_areas-${report.dryRun ? "dryrun-" : ""}${report.runId}.json`,
		),
		`${JSON.stringify(report, null, 2)}\n`,
	);
	return report;
}

export async function catalogAreaKeywords(args: string[]) {
	const deps = await loadCatalogAreaKeywordsDependencies();
	await deps.waitForDb();
	const db = deps.getDb().db;
	try {
		const report = await runCatalogAreaKeywords(args, deps, db);
		const { totals } = report;
		console.log(
			`[catalog:area-keywords] ${report.dryRun ? "Prueba en seco" : "Aplicado"}: ${totals.identical} idénticas a un área, ${totals.review} a revisar, ${totals.keep} sin área equivalente.`,
		);
		console.log(
			report.dryRun
				? `[catalog:area-keywords] Se retirarían ${report.toRetire.length}: ${report.toRetire.join(", ")}`
				: `[catalog:area-keywords] Retiradas ${totals.retired}: ${report.retired.join(", ")}`,
		);
	} finally {
		await closeCliDb(db);
	}
}
