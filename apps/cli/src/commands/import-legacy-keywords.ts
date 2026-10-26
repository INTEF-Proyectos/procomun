/**
 * Correspondencia de las etiquetas de origen (`resources.keywords`) con el
 * catálogo de palabras clave (issue #384, apartado 5; ADR-0042).
 * Uso: import:legacy-keywords [--dry-run] [--report-dir <ruta>]
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

export async function loadImportLegacyKeywordsDependencies() {
	const [{ getDb, waitForDb }, repo, { updateSearchVector }] =
		await Promise.all([
			import("../../../api/src/db.ts"),
			import("@procomun/db/repository"),
			import("../../../api/src/fts/search.ts"),
		]);
	return {
		getDb,
		waitForDb,
		mapLegacyKeywords: repo.mapLegacyKeywords,
		updateSearchVector,
	};
}

type Deps = Awaited<ReturnType<typeof loadImportLegacyKeywordsDependencies>>;

export function parseImportLegacyKeywordsArgs(args: string[]) {
	const { values } = parseArgs({
		args,
		options: {
			"dry-run": { type: "boolean", default: false },
			"report-dir": { type: "string" },
		},
		strict: true,
	});
	return {
		dryRun: Boolean(values["dry-run"]),
		reportDir: path.resolve(
			values["report-dir"] ??
				path.join(
					import.meta.dir,
					"../../../../local-data/legacy-import-reports",
				),
		),
	};
}

/** Ejecuta la correspondencia, reindexa lo asignado y escribe el informe. */
export async function runImportLegacyKeywords(
	options: ReturnType<typeof parseImportLegacyKeywordsArgs>,
	deps: Deps,
): Promise<string> {
	await deps.waitForDb();
	const db = deps.getDb().db;
	const report = await deps.mapLegacyKeywords(db, { dryRun: options.dryRun });
	if (!options.dryRun) {
		// Las palabras del catálogo entran en el vector de búsqueda (ADR-0042).
		for (const { resourceId } of report.assigned) {
			await deps.updateSearchVector(db, resourceId);
		}
	}

	await mkdir(options.reportDir, { recursive: true });
	const reportPath = path.join(
		options.reportDir,
		`informe_palabras_clave-${options.dryRun ? "dryrun-" : ""}${crypto.randomUUID()}.json`,
	);
	await Bun.write(reportPath, JSON.stringify(report, null, 2));

	const { totals } = report;
	console.log(
		`[import:legacy-keywords] ${options.dryRun ? "(dry-run) " : ""}` +
			`recursos=${totals.resources} con_correspondencia=${totals.withMatch} ` +
			`(${(totals.coverage * 100).toFixed(1)} %) ` +
			`${options.dryRun ? "asignables" : "asignados"}=${totals.assigned} ` +
			`ya_asignados=${totals.alreadyAssigned} mas_de_5=${totals.overLimit} ` +
			`sin_correspondencia=${report.unmatched.length} ambiguas=${report.ambiguous.length}`,
	);
	console.log(`[import:legacy-keywords] Informe escrito en ${reportPath}`);
	return reportPath;
}

export async function importLegacyKeywords(args: string[]) {
	await runImportLegacyKeywords(
		parseImportLegacyKeywordsArgs(args),
		await loadImportLegacyKeywordsDependencies(),
	);
}
