/**
 * CLI command: importa recursos legacy de Procomún (pares <id>.json + <id>.elpx)
 * a procomun-ng, de forma idempotente (ver ADR-0029 y
 * docs/epics/epic-004-migracion-legacy-procomun/).
 *
 * Uso:
 *   bun run apps/cli/src/index.ts import:legacy-procomun --source-dir <ruta> [--dry-run] [--limit <n>] [--only <externalId>] [--report-dir <ruta>]
 *   bun run apps/cli/src/index.ts import:legacy-procomun --backfill-categories [--dry-run] [--report-dir <ruta>]
 *   bun run apps/cli/src/index.ts import:legacy-procomun --fix-published --source-dir <ruta> [--dry-run] [--report-dir <ruta>]
 *   bun run apps/cli/src/index.ts import:legacy-procomun --copy-previews [--dry-run] [--report-dir <ruta>]
 *   bun run apps/cli/src/index.ts import:legacy-procomun --fix-language --source-dir <ruta> [--dry-run] [--report-dir <ruta>]
 *   bun run apps/cli/src/index.ts import:legacy-procomun --mark-certified --source-dir <ruta> [--dry-run] [--report-dir <ruta>]
 */
import { mkdir, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
	assertLegacyCategoryDestinations,
	type EducationalImportResourceNote,
	IMPORT_SOURCE,
	type LegacyOdeJson,
	summarizeLegacyEducationalImport,
} from "@procomun/db/legacy-import";
import {
	formatImportError,
	type ImportErrorSummary,
	summarizeDbStepError,
	summarizeImportError,
	withoutDbDetails,
} from "../import-errors.ts";

export async function loadImportLegacyProcomunDependencies() {
	const [
		{ getDb, waitForDb },
		{ processElpxUpload, removeElpxExtraction, buildElpxPath },
		{
			getUploadConfig,
			ensureUploadStorageDir,
			computeFileSha256,
			buildUploadPublicUrl,
			sanitizeFilename,
		},
		{ updateSearchVector },
		{ copyLegacyPreviewImage, isAllowedPreviewImageUrl },
		legacyImport,
		repo,
	] = await Promise.all([
		import("../../../api/src/db.ts"),
		import("../../../api/src/services/elpx-processor.ts"),
		import("../../../api/src/uploads/config.ts"),
		import("../../../api/src/fts/search.ts"),
		import("../../../api/src/services/legacy-preview-image.ts"),
		import("@procomun/db/legacy-import"),
		import("@procomun/db/repository"),
	]);

	return {
		getDb,
		waitForDb,
		processElpxUpload,
		removeElpxExtraction,
		buildElpxPath,
		getUploadConfig,
		ensureUploadStorageDir,
		computeFileSha256,
		buildUploadPublicUrl,
		sanitizeFilename,
		updateSearchVector,
		copyLegacyPreviewImage,
		isAllowedPreviewImageUrl,
		listLegacyRemoteThumbnails: repo.listLegacyRemoteThumbnails,
		setResourceThumbnailUrl: repo.setResourceThumbnailUrl,
		mapLegacyRecord: legacyImport.mapLegacyRecord,
		normalizeLanguage: legacyImport.normalizeLanguage,
		resolveLegacyPublicationStatus: legacyImport.resolveLegacyPublicationStatus,
		isLegacyCertified: legacyImport.isLegacyCertified,
		resolveLegacyExternalId: legacyImport.resolveLegacyExternalId,
		ensureLegacyImportSystemUser: legacyImport.ensureLegacyImportSystemUser,
		// Solo las operaciones de repositorio que usa este comando. Exponer el
		// módulo completo forzaría a los mocks de unit test a implementar ~60
		// exports irrelevantes y haría frágil el contrato de dependencias.
		repo: {
			backfillLegacyEducationalAreas: repo.backfillLegacyEducationalAreas,
			findLegacyResourceByExternalId: repo.findLegacyResourceByExternalId,
			fixLegacyResourceLanguage: repo.fixLegacyResourceLanguage,
			getElpxProjectByHash: repo.getElpxProjectByHash,
			importLegacyResourceWithElpx: repo.importLegacyResourceWithElpx,
			markLegacyResourceCertified: repo.markLegacyResourceCertified,
			unpublishUnreviewedLegacyResource: repo.unpublishUnreviewedLegacyResource,
		},
	};
}

type Deps = Awaited<ReturnType<typeof loadImportLegacyProcomunDependencies>>;

interface PairedSource {
	/** Nombre base compartido por `.json` y `.elpx` (solo agrupación de ficheros). */
	baseName: string;
	jsonPath: string;
	elpxPath: string;
}

export async function findLegacySourcePairs(
	sourceDir: string,
): Promise<{ pairs: PairedSource[]; incomplete: string[] }> {
	const entries = await readdir(sourceDir);
	const byBase = new Map<string, { json?: string; elpx?: string }>();

	for (const entry of entries) {
		const ext = path.extname(entry).toLowerCase();
		if (ext !== ".json" && ext !== ".elpx") continue;
		const base = entry.slice(0, -ext.length);
		const record = byBase.get(base) ?? {};
		if (ext === ".json") record.json = path.join(sourceDir, entry);
		else record.elpx = path.join(sourceDir, entry);
		byBase.set(base, record);
	}

	const pairs: PairedSource[] = [];
	const incomplete: string[] = [];
	for (const [baseName, record] of [...byBase.entries()].sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		if (record.json && record.elpx) {
			pairs.push({ baseName, jsonPath: record.json, elpxPath: record.elpx });
		} else {
			incomplete.push(baseName);
		}
	}

	return { pairs, incomplete };
}

interface ResolvedPair {
	pair: PairedSource;
	/** externalId resuelto desde el JSON, o baseName del fichero si no pudo leerse/parsearse. */
	externalId: string;
	json?: LegacyOdeJson;
	parseError?: string;
}

/**
 * Lee y parsea el `.json` de cada par de uno en uno (generador async, no un
 * array precomputado): con el volumen real documentado (~78.800 recursos,
 * ver ADR-0029), materializar todos los JSON en memoria antes de aplicar
 * `--only`/`--limit` no escala y hace que `--limit 1` igualmente parsee el
 * lote completo. Al consumirse con `for await` + `break`, el llamante deja de
 * leer ficheros en cuanto tiene lo que necesita.
 *
 * Resuelve el `externalId` real (`idODE`/`id`) desde el contenido del JSON:
 * el nombre de fichero no es un identificador fiable (solo coincide con
 * `idODE` en la muestra observada), así que `--only <externalId>` debe
 * filtrar por el valor real del JSON, no por el nombre base. Los fallos de
 * lectura/parseo se capturan por par en vez de propagarse, para que un
 * `.json` corrupto no aborte el resto del lote.
 */
export async function* iterateResolvedPairs(
	pairs: PairedSource[],
	resolveLegacyExternalId: (json: LegacyOdeJson) => string,
): AsyncGenerator<ResolvedPair> {
	for (const pair of pairs) {
		try {
			const json = (await Bun.file(pair.jsonPath).json()) as LegacyOdeJson;
			const externalId = resolveLegacyExternalId(json) || pair.baseName;
			yield { pair, externalId, json };
		} catch (err) {
			yield {
				pair,
				externalId: pair.baseName,
				parseError: err instanceof Error ? err.message : String(err),
			};
		}
	}
}

/** Estado asignado y valor de `published` recibido (issue #447). */
interface PublicationTrace {
	editorialStatus: "published" | "draft";
	sourcePublished: string | number | null;
	/** `certified: 1` en origen (#420). */
	certified: boolean;
}

type RecordOutcome =
	| ({
			outcome: "imported";
			externalId: string;
			resourceId: string;
			warnings: string[];
	  } & PublicationTrace)
	| ({
			outcome: "would_import";
			externalId: string;
			warnings: string[];
	  } & PublicationTrace)
	| { outcome: "skipped_existing"; externalId: string }
	| { outcome: "blocked"; externalId: string; reasons: string[] }
	/**
	 * Un error de la base de datos solo deja su código: su mensaje lleva la
	 * consulta y los parámetros, con autores y correos (#488).
	 */
	| ({ outcome: "error"; externalId: string } & ImportErrorSummary);

export interface ImportLegacyProcomunReport {
	runId: string;
	sourceDir: string;
	dryRun: boolean;
	startedAt: string;
	finishedAt: string;
	totals: {
		pairsFound: number;
		incompletePairs: number;
		processed: number;
		imported: number;
		/** De los importados, los que entran como borrador por su `published`. */
		importedAsDraft: number;
		/** De los importados, los que entran con el sello «Validado» (#420). */
		importedValidated: number;
		/** Certificados en origen que entran como borrador, sin sello (#420). */
		certifiedAsDraft: number;
		skippedExisting: number;
		blocked: number;
		errored: number;
	};
	incompletePairs: string[];
	records: RecordOutcome[];
	categorizacionEducativa: ReturnType<typeof summarizeLegacyEducationalImport>;
}

function parseCliArgs(args: string[]) {
	const { values } = parseArgs({
		args,
		options: {
			"source-dir": { type: "string" },
			"backfill-categories": { type: "boolean", default: false },
			"fix-published": { type: "boolean", default: false },
			"fix-language": { type: "boolean", default: false },
			"mark-certified": { type: "boolean", default: false },
			"copy-previews": { type: "boolean", default: false },
			"dry-run": { type: "boolean", default: false },
			limit: { type: "string" },
			only: { type: "string" },
			"report-dir": { type: "string" },
		},
		strict: true,
	});

	const backfillCategories = Boolean(values["backfill-categories"]);
	const fixPublished = Boolean(values["fix-published"]);
	const fixLanguage = Boolean(values["fix-language"]);
	const copyPreviews = Boolean(values["copy-previews"]);
	const markCertified = Boolean(values["mark-certified"]);
	if (
		[
			backfillCategories,
			fixPublished,
			fixLanguage,
			copyPreviews,
			markCertified,
		].filter(Boolean).length > 1
	) {
		throw new Error(
			"--backfill-categories, --fix-published, --fix-language, --copy-previews y --mark-certified no se pueden combinar",
		);
	}
	const sourceDir = values["source-dir"];
	if (!sourceDir && !backfillCategories && !copyPreviews) {
		throw new Error(
			"Falta --source-dir. Uso: import:legacy-procomun --source-dir <ruta> [--dry-run] [--limit <n>] [--only <externalId>] [--report-dir <ruta>]",
		);
	}

	const limit = values.limit != null ? Number(values.limit) : undefined;
	if (limit != null && (!Number.isFinite(limit) || limit <= 0)) {
		throw new Error(`--limit inválido: ${values.limit}`);
	}

	return {
		sourceDir: sourceDir ? path.resolve(sourceDir) : "",
		backfillCategories,
		fixPublished,
		fixLanguage,
		copyPreviews,
		markCertified,
		dryRun: Boolean(values["dry-run"]),
		limit,
		only: values.only,
		reportDir: path.resolve(
			values["report-dir"] ??
				path.join(
					import.meta.dir,
					"../../../../local-data/legacy-import-reports",
				),
		),
	};
}

export async function importLegacyProcomun(
	args: string[],
	loadDeps: () => Promise<Deps> = loadImportLegacyProcomunDependencies,
) {
	try {
		await runImportLegacyProcomunCommand(args, loadDeps);
	} catch (error) {
		// Lo que se escapa de los bucles lo escribe entero el manejador del CLI.
		throw withoutDbDetails(error);
	}
}

async function runImportLegacyProcomunCommand(
	args: string[],
	loadDeps: () => Promise<Deps>,
) {
	const options = parseCliArgs(args);
	const deps = await loadDeps();

	if (options.copyPreviews) {
		const copyReport = await runCopyLegacyPreviews(options, deps);
		await writeReport(options, "copia-miniaturas", copyReport);
		const t = copyReport.totals;
		console.log(
			`[import:legacy-procomun] Completado. ${options.dryRun ? "(dry-run) " : ""}` +
				`revisados=${t.processed} copiadas=${t.copied} retiradas=${t.removed} ` +
				`reintentar=${t.retryable}`,
		);
		await closeDbAndExit(deps, 0);
		return;
	}

	if (options.fixPublished) {
		const fixReport = await runFixLegacyPublished(options, deps);
		await writeReport(options, "correccion-publicados", fixReport);
		const t = fixReport.totals;
		console.log(
			`[import:legacy-procomun] Completado. ${options.dryRun ? "(dry-run) " : ""}` +
				`revisados=${t.processed} publicados_en_origen=${t.publishedAtSource} ` +
				`a_borrador=${t.unpublished} ya_revisados=${t.reviewed} ` +
				`no_publicados=${t.notPublished} no_importados=${t.notFound} errores=${t.errored}`,
		);
		await closeDbAndExit(deps, t.errored > 0 ? 1 : 0);
		return;
	}

	if (options.markCertified) {
		const markReport = await runMarkLegacyCertified(options, deps);
		await writeReport(options, "sello-certificados", markReport);
		const t = markReport.totals;
		console.log(
			`[import:legacy-procomun] Completado. ${options.dryRun ? "(dry-run) " : ""}` +
				`revisados=${t.processed} certificados_en_origen=${t.certifiedAtSource} ` +
				`marcados=${t.marked} ya_validados=${t.alreadyValidated} ` +
				`no_publicados=${t.notPublished} editados=${t.edited} ` +
				`no_importados=${t.notFound} errores=${t.errored}`,
		);
		await closeDbAndExit(deps, t.errored > 0 ? 1 : 0);
		return;
	}

	if (options.fixLanguage) {
		const fixReport = await runFixLegacyLanguage(options, deps);
		await writeReport(options, "correccion-idioma", fixReport);
		const t = fixReport.totals;
		console.log(
			`[import:legacy-procomun] Completado. ${options.dryRun ? "(dry-run) " : ""}` +
				`revisados=${t.processed} corregidos=${t.fixed} sin_cambios=${t.unchanged} ` +
				`respetados=${t.kept} no_importados=${t.notFound} errores=${t.errored}`,
		);
		await closeDbAndExit(deps, t.errored > 0 ? 1 : 0);
		return;
	}

	const report = options.backfillCategories
		? await runBackfillLegacyEducationalAreas(options, deps)
		: await runImportLegacyProcomun(options, deps);

	await writeReport(
		options,
		options.backfillCategories ? "relleno-categorias" : "ingesta",
		report,
	);

	console.log(
		`[import:legacy-procomun] Completado. ${options.dryRun ? "(dry-run) " : ""}` +
			("imported" in report.totals
				? `importados=${report.totals.imported} omitidos_ya_existentes=${report.totals.skippedExisting} ` +
					`bloqueados=${report.totals.blocked} errores=${report.totals.errored} incompletos=${report.totals.incompletePairs} `
				: `sin_clasificar_revisados=${report.totals.processed} `) +
			`categorias_ok=${report.categorizacionEducativa.recursosConTodasTransformadas} ` +
			`categorias_revision=${report.categorizacionEducativa.recursosPendientesDeRevision} ` +
			`sin_categoria=${report.categorizacionEducativa.recursosSinCategorizacionDeOrigen} ` +
			`ele_otro_idioma=${report.categorizacionEducativa.eleEnOtroIdioma.length}`,
	);

	// Calculado ANTES de cerrar la conexión: el runtime WASM de PGlite puede
	// mutar process.exitCode de forma asíncrona en background (ver comentario
	// en closeDbAndExit), así que no hay que confiar en su valor en este punto.
	const exitCode =
		"errored" in report.totals && report.totals.errored > 0 ? 1 : 0;
	await closeDbAndExit(deps, exitCode);
}

async function writeReport(
	options: { reportDir: string; dryRun: boolean },
	kind: string,
	report: { runId: string },
) {
	await mkdir(options.reportDir, { recursive: true });
	const reportPath = path.join(
		options.reportDir,
		`informe_${kind}-${options.dryRun ? "dryrun-" : ""}${report.runId}.json`,
	);
	await Bun.write(reportPath, JSON.stringify(report, null, 2));
	console.log(`[import:legacy-procomun] Informe escrito en ${reportPath}`);
}

async function closeDbAndExit(deps: Deps, exitCode: number) {
	// La conexión PGlite compartida (apps/api/src/db.ts) está pensada para un
	// proceso servidor de larga vida y nunca se cierra explícitamente. En un
	// script de un solo uso como este CLI, el runtime WASM/Emscripten de
	// PGlite detecta que el proceso Node/Bun va a terminar sin haber cerrado
	// limpiamente su instancia y fija `process.exitCode = 99` como red de
	// seguridad (ver quit_() en @electric-sql/pglite) — reproducible incluso
	// llamando a process.exit(0) explícitamente. Cerrar el cliente antes de
	// salir evita esa ruta y deja el código de salida real (0/1).
	// DrizzleDB (PgDatabase) no expone `$client` en el tipo; en runtime PGlite
	// sí lo tiene. Se comprueba con `in` para no acoplar el tipo a un driver.
	const dbHandle = deps.getDb().db;
	const client =
		"$client" in dbHandle
			? (dbHandle.$client as { close?: () => unknown } | undefined)
			: undefined;
	if (typeof client?.close === "function") {
		try {
			await client.close();
		} catch {
			// No impide reportar el resultado real de la importación.
		}
	}

	process.exit(exitCode);
}

/**
 * `--backfill-categories`: la reimportación omite los recursos ya existentes,
 * así que lo importado antes de #383 se quedaría sin clasificar. Esta pasada
 * aplica la correspondencia a su resource_levels (el learningContext original)
 * y devuelve el mismo informe de categorización que la importación.
 */
export async function runBackfillLegacyEducationalAreas(
	options: { dryRun: boolean },
	deps: Deps,
) {
	const startedAt = new Date().toISOString();
	await deps.waitForDb();
	assertLegacyCategoryDestinations();
	const notes = await deps.repo.backfillLegacyEducationalAreas(
		deps.getDb().db,
		{ dryRun: options.dryRun },
	);
	return {
		runId: crypto.randomUUID(),
		dryRun: options.dryRun,
		startedAt,
		finishedAt: new Date().toISOString(),
		totals: { processed: notes.length },
		categorizacionEducativa: summarizeLegacyEducationalImport(notes),
	};
}

type FixPublishedRecord = {
	externalId: string;
	sourcePublished: string | number | null;
} & (
	| {
			outcome: "unpublished" | "would_unpublish" | "reviewed" | "not_published";
			resourceId: string;
	  }
	| { outcome: "not_found" }
	| ({ outcome: "error" } & ImportErrorSummary)
);

export interface FixLegacyPublishedReport {
	runId: string;
	sourceDir: string;
	dryRun: boolean;
	startedAt: string;
	finishedAt: string;
	totals: {
		processed: number;
		publishedAtSource: number;
		unpublished: number;
		reviewed: number;
		notPublished: number;
		notFound: number;
		errored: number;
	};
	/** Solo los JSON con `published` distinto de 1: los publicados se cuentan. */
	records: FixPublishedRecord[];
}

/**
 * `--fix-published` (issue #447): hasta el arreglo el importador publicaba
 * todo, y la reimportación omite lo ya importado. Esta pasada relee los JSON
 * de origen y pasa a borrador los recursos cuyo `published` no es 1, salvo los
 * que ya tienen una decisión editorial (ver unpublishUnreviewedLegacyResource).
 */
export async function runFixLegacyPublished(
	options: { sourceDir: string; dryRun: boolean },
	deps: Deps,
): Promise<FixLegacyPublishedReport> {
	const startedAt = new Date().toISOString();
	await deps.waitForDb();
	const db = deps.getDb().db;
	const { pairs } = await findLegacySourcePairs(options.sourceDir);

	const totals = {
		processed: 0,
		publishedAtSource: 0,
		unpublished: 0,
		reviewed: 0,
		notPublished: 0,
		notFound: 0,
		errored: 0,
	};
	const records: FixPublishedRecord[] = [];

	for await (const resolved of iterateResolvedPairs(
		pairs,
		deps.resolveLegacyExternalId,
	)) {
		totals.processed++;
		if (!resolved.json) {
			totals.errored++;
			records.push({
				externalId: resolved.externalId,
				sourcePublished: null,
				outcome: "error",
				code: "invalid_record",
				message: `No se pudo leer/parsear el JSON: ${resolved.parseError}`,
			});
			continue;
		}
		const publication = deps.resolveLegacyPublicationStatus(
			resolved.json.published,
		);
		if (publication.editorialStatus === "published") {
			totals.publishedAtSource++;
			continue;
		}
		const trace = {
			externalId: resolved.externalId,
			sourcePublished: publication.sourcePublished,
		};
		try {
			const result = await deps.repo.unpublishUnreviewedLegacyResource(
				db,
				IMPORT_SOURCE,
				resolved.externalId,
				{ dryRun: options.dryRun },
			);
			if (result.outcome === "not_found") {
				totals.notFound++;
				records.push({ ...trace, outcome: "not_found" });
				continue;
			}
			if (result.outcome === "unpublished") totals.unpublished++;
			else if (result.outcome === "reviewed") totals.reviewed++;
			else totals.notPublished++;
			records.push({
				...trace,
				outcome:
					result.outcome === "unpublished" && options.dryRun
						? "would_unpublish"
						: result.outcome,
				resourceId: result.resourceId,
			});
			if (result.outcome === "unpublished") {
				console.log(
					`[a borrador${options.dryRun ? " (dry-run)" : ""}] ${resolved.externalId} (published=${JSON.stringify(publication.sourcePublished)})`,
				);
			}
		} catch (err) {
			totals.errored++;
			// Este paso solo usa la base de datos: nunca se copia el mensaje.
			const summary = summarizeDbStepError(err);
			records.push({ ...trace, outcome: "error", ...summary });
			console.error(
				`[error] ${resolved.externalId}: ${formatImportError(summary)}`,
			);
		}
	}

	return {
		runId: crypto.randomUUID(),
		sourceDir: options.sourceDir,
		dryRun: options.dryRun,
		startedAt,
		finishedAt: new Date().toISOString(),
		totals,
		records,
	};
}

type MarkCertifiedRecord = { externalId: string } & (
	| {
			outcome:
				| "marked"
				| "would_mark"
				| "already_validated"
				| "not_published"
				| "edited";
			resourceId: string;
	  }
	| { outcome: "not_found" }
	| ({ outcome: "error" } & ImportErrorSummary)
);

export interface MarkLegacyCertifiedReport {
	runId: string;
	sourceDir: string;
	dryRun: boolean;
	startedAt: string;
	finishedAt: string;
	totals: {
		processed: number;
		certifiedAtSource: number;
		marked: number;
		alreadyValidated: number;
		notPublished: number;
		edited: number;
		notFound: number;
		errored: number;
	};
	/** Solo los certificados en origen: el resto solo se cuenta. */
	records: MarkCertifiedRecord[];
}

/**
 * `--mark-certified` (issue #420): la reimportación omite lo ya importado, así
 * que lo importado antes de leer `certified` se quedaría sin sello. Esta pasada
 * relee los JSON y da el sello de origen a los certificados que siguen
 * publicados, sin sello y sin cambios (ver markLegacyResourceCertified).
 */
export async function runMarkLegacyCertified(
	options: { sourceDir: string; dryRun: boolean },
	deps: Deps,
): Promise<MarkLegacyCertifiedReport> {
	const startedAt = new Date().toISOString();
	await deps.waitForDb();
	const db = deps.getDb().db;
	const { pairs } = await findLegacySourcePairs(options.sourceDir);

	const totals = {
		processed: 0,
		certifiedAtSource: 0,
		marked: 0,
		alreadyValidated: 0,
		notPublished: 0,
		edited: 0,
		notFound: 0,
		errored: 0,
	};
	const records: MarkCertifiedRecord[] = [];

	for await (const resolved of iterateResolvedPairs(
		pairs,
		deps.resolveLegacyExternalId,
	)) {
		totals.processed++;
		const { externalId } = resolved;
		if (!resolved.json) {
			totals.errored++;
			records.push({
				externalId,
				outcome: "error",
				code: "invalid_record",
				message: `No se pudo leer/parsear el JSON: ${resolved.parseError}`,
			});
			continue;
		}
		if (!deps.isLegacyCertified(resolved.json.certified)) continue;
		totals.certifiedAtSource++;
		// Igual que al importar: sin `published: 1` en origen no hay sello,
		// aunque en la base siga publicado (lo corrige --fix-published).
		const publishedAtSource =
			deps.resolveLegacyPublicationStatus(resolved.json.published)
				.editorialStatus === "published";
		try {
			let result: Awaited<
				ReturnType<Deps["repo"]["markLegacyResourceCertified"]>
			>;
			if (publishedAtSource) {
				result = await deps.repo.markLegacyResourceCertified(
					db,
					IMPORT_SOURCE,
					externalId,
					{ dryRun: options.dryRun },
				);
			} else {
				const found = await deps.repo.findLegacyResourceByExternalId(
					db,
					IMPORT_SOURCE,
					externalId,
				);
				result = found
					? { outcome: "not_published", resourceId: found.id }
					: { outcome: "not_found", resourceId: null };
			}
			if (result.outcome === "not_found") {
				totals.notFound++;
				records.push({ externalId, outcome: "not_found" });
				continue;
			}
			if (result.outcome === "marked") totals.marked++;
			else if (result.outcome === "already_validated")
				totals.alreadyValidated++;
			else if (result.outcome === "not_published") totals.notPublished++;
			else totals.edited++;
			records.push({
				externalId,
				outcome:
					result.outcome === "marked" && options.dryRun
						? "would_mark"
						: result.outcome,
				resourceId: result.resourceId,
			});
			if (result.outcome === "marked") {
				console.log(
					`[sello${options.dryRun ? " (dry-run)" : ""}] ${externalId}: validado en origen`,
				);
			}
		} catch (err) {
			totals.errored++;
			// Solo usa la base de datos: nunca se copia el mensaje (#488).
			const summary = summarizeDbStepError(err);
			records.push({ externalId, outcome: "error", ...summary });
			console.error(`[error] ${externalId}: ${formatImportError(summary)}`);
		}
	}

	return {
		runId: crypto.randomUUID(),
		sourceDir: options.sourceDir,
		dryRun: options.dryRun,
		startedAt,
		finishedAt: new Date().toISOString(),
		totals,
		records,
	};
}

type FixLanguageRecord = { externalId: string } & (
	| {
			outcome: "fixed" | "would_fix" | "kept";
			resourceId: string;
			from: string | null;
			to: string | null;
			/**
			 * El idioma se corrigio pero la reindexacion fallo (revisión #475).
			 * El recurso queda con el indice del idioma anterior y una segunda
			 * pasada lo dara por «sin cambios», asi que hay que reindexarlo con
			 * el comando de reindexacion.
			 */
			reindexError?: string;
	  }
	| { outcome: "not_found" }
	| { outcome: "error"; message: string }
);

export interface FixLegacyLanguageReport {
	runId: string;
	sourceDir: string;
	dryRun: boolean;
	startedAt: string;
	finishedAt: string;
	totals: {
		processed: number;
		fixed: number;
		unchanged: number;
		kept: number;
		notFound: number;
		errored: number;
		/**
		 * Idioma corregido pero indice de busqueda sin regenerar (revisión
		 * #475). Esos recursos necesitan una reindexacion manual: otra pasada
		 * de --fix-language los dara por «sin cambios».
		 */
		reindexFailed: number;
	};
	/** Sin los que ya coinciden con el origen: esos solo se cuentan. */
	records: FixLanguageRecord[];
}

/**
 * `--fix-language` (issue #473): hasta el arreglo el importador ponía "es" a
 * lo que no traía idioma reconocible en generalLanguageStr, y la reimportación
 * omite lo ya importado. Esta pasada relee los JSON y corrige los recursos que
 * siguen en "es" (ver fixLegacyResourceLanguage); un idioma distinto se
 * respeta porque vino del origen o de una edición.
 */
/**
 * Resumen del fallo al reindexar, sin el mensaje del error (revisión #475,
 * issue #543). Los errores de Drizzle traen la consulta SQL y sus parametros,
 * y aqui los parametros incluyen el texto del recurso. Se queda el tipo de
 * error, que basta para diagnosticar y no lleva datos.
 */
export function summarizeReindexError(err: unknown): string {
	const name =
		err instanceof Error && err.constructor?.name
			? err.constructor.name
			: typeof err;
	return `fallo al reindexar (${name}); detalle no registrado para no copiar la consulta ni sus parametros`;
}

export async function runFixLegacyLanguage(
	options: { sourceDir: string; dryRun: boolean },
	deps: Deps,
): Promise<FixLegacyLanguageReport> {
	const startedAt = new Date().toISOString();
	await deps.waitForDb();
	const db = deps.getDb().db;
	const { pairs } = await findLegacySourcePairs(options.sourceDir);

	const totals = {
		processed: 0,
		fixed: 0,
		unchanged: 0,
		kept: 0,
		notFound: 0,
		errored: 0,
		/** Idioma corregido pero indice sin regenerar (revisión #475). */
		reindexFailed: 0,
	};
	const records: FixLanguageRecord[] = [];

	for await (const resolved of iterateResolvedPairs(
		pairs,
		deps.resolveLegacyExternalId,
	)) {
		totals.processed++;
		const { externalId } = resolved;
		if (!resolved.json) {
			totals.errored++;
			records.push({
				externalId,
				outcome: "error",
				message: `No se pudo leer/parsear el JSON: ${resolved.parseError}`,
			});
			continue;
		}
		const to = deps.normalizeLanguage(resolved.json.generalLanguageStr);
		try {
			const result = await deps.repo.fixLegacyResourceLanguage(
				db,
				IMPORT_SOURCE,
				externalId,
				to,
				{ dryRun: options.dryRun },
			);
			if (result.outcome === "not_found") {
				totals.notFound++;
				records.push({ externalId, outcome: "not_found" });
				continue;
			}
			if (result.outcome === "unchanged") {
				totals.unchanged++;
				continue;
			}
			const from = result.language;
			// El idioma decide la configuracion de to_tsvector, y no hay trigger
			// que regenere el indice al cambiarlo: sin esto el recurso se queda
			// indexado en el idioma anterior y deja de encontrarse por su texto,
			// y repetir la pasada no lo arregla porque ya lo da por «sin
			// cambios» (revisión #475). En seco no se escribe nada.
			let reindexError: string | undefined;
			if (result.outcome === "fixed" && !options.dryRun) {
				try {
					await deps.updateSearchVector(db, result.resourceId);
				} catch (err) {
					reindexError = summarizeReindexError(err);
					totals.reindexFailed++;
					console.error(
						`[reindexado] ${externalId}: ${reindexError}. El idioma ya esta corregido; reindexa este recurso con el comando de reindexacion, porque otra pasada de --fix-language lo dara por «sin cambios».`,
					);
				}
			}
			if (result.outcome === "fixed") {
				totals.fixed++;
				console.log(
					`[idioma${options.dryRun ? " (dry-run)" : ""}] ${externalId}: es -> ${to ?? "sin idioma"}`,
				);
			} else totals.kept++;
			records.push({
				externalId,
				outcome:
					result.outcome === "fixed" && options.dryRun
						? "would_fix"
						: result.outcome,
				resourceId: result.resourceId,
				from,
				to,
				...(reindexError ? { reindexError } : {}),
			});
		} catch (err) {
			totals.errored++;
			const message = err instanceof Error ? err.message : String(err);
			records.push({ externalId, outcome: "error", message });
			console.error(`[error] ${externalId}: ${message}`);
		}
	}

	return {
		runId: crypto.randomUUID(),
		sourceDir: options.sourceDir,
		dryRun: options.dryRun,
		startedAt,
		finishedAt: new Date().toISOString(),
		totals,
		records,
	};
}

type CopyPreviewRecord = {
	externalId: string | null;
	resourceId: string;
	sourceUrl: string;
} & (
	| { outcome: "copied"; url: string }
	| { outcome: "would_copy" | "would_remove" }
	| { outcome: "removed" | "retryable"; reason: string }
);

export interface CopyLegacyPreviewsReport {
	runId: string;
	dryRun: boolean;
	startedAt: string;
	finishedAt: string;
	totals: {
		processed: number;
		copied: number;
		removed: number;
		retryable: number;
	};
	records: CopyPreviewRecord[];
}

/**
 * `--copy-previews` (#409): hasta el arreglo el importador guardaba la URL de
 * `preview` tal cual y la ficha la enlazaba en caliente desde
 * ode.educacion.es. Esta pasada la copia a nuestro almacenamiento. Si no se
 * puede de forma definitiva (otro host, no es imagen, 404…) se retira; si el
 * fallo es pasajero (red, 5xx) se deja para repetir el comando. El informe
 * conserva la URL de origen. En dry-run no descarga: clasifica por host.
 */
export async function runCopyLegacyPreviews(
	options: { dryRun: boolean },
	deps: Deps,
): Promise<CopyLegacyPreviewsReport> {
	const startedAt = new Date().toISOString();
	await deps.waitForDb();
	const db = deps.getDb().db;
	const { storageDir } = deps.getUploadConfig();
	const totals = { processed: 0, copied: 0, removed: 0, retryable: 0 };
	const records: CopyPreviewRecord[] = [];

	for (const row of await deps.listLegacyRemoteThumbnails(db, IMPORT_SOURCE)) {
		if (!row.thumbnailUrl) continue;
		totals.processed++;
		const trace = {
			externalId: row.externalId,
			resourceId: row.id,
			sourceUrl: row.thumbnailUrl,
		};

		if (options.dryRun) {
			const allowed = deps.isAllowedPreviewImageUrl(row.thumbnailUrl);
			if (allowed) totals.copied++;
			else totals.removed++;
			records.push({
				...trace,
				outcome: allowed ? "would_copy" : "would_remove",
			});
			continue;
		}

		const result = await deps.copyLegacyPreviewImage(row.thumbnailUrl, {
			storageDir,
		});
		if (result.ok) {
			await deps.setResourceThumbnailUrl(db, row.id, result.url);
			totals.copied++;
			records.push({ ...trace, outcome: "copied", url: result.url });
		} else if (result.retryable) {
			totals.retryable++;
			records.push({ ...trace, outcome: "retryable", reason: result.reason });
		} else {
			await deps.setResourceThumbnailUrl(db, row.id, null);
			totals.removed++;
			records.push({ ...trace, outcome: "removed", reason: result.reason });
		}
	}

	return {
		runId: crypto.randomUUID(),
		dryRun: options.dryRun,
		startedAt,
		finishedAt: new Date().toISOString(),
		totals,
		records,
	};
}

/**
 * Núcleo del importador, separado de `importLegacyProcomun` (que gestiona
 * args de CLI y escritura del informe) para poder testear el flujo completo
 * inyectando dependencias sin pasar por `process.exit`/parseArgs.
 */
export async function runImportLegacyProcomun(
	options: {
		sourceDir: string;
		dryRun: boolean;
		limit?: number;
		only?: string;
	},
	deps: Deps,
): Promise<ImportLegacyProcomunReport> {
	const startedAt = new Date().toISOString();
	const runId = crypto.randomUUID();

	await deps.waitForDb();
	const db = deps.getDb().db;
	const config = deps.getUploadConfig();

	if (!options.dryRun) {
		await deps.ensureUploadStorageDir(config);
	}
	const systemUser = options.dryRun
		? null
		: await deps.ensureLegacyImportSystemUser(db);

	const { pairs: allPairs, incomplete } = await findLegacySourcePairs(
		options.sourceDir,
	);

	console.log(
		`[import:legacy-procomun] ${allPairs.length} pares encontrados en ${options.sourceDir}` +
			`${options.dryRun ? " (dry-run)" : ""}` +
			`${options.only ? ` (--only ${options.only})` : ""}` +
			`${options.limit != null ? ` (--limit ${options.limit})` : ""}...`,
	);
	if (incomplete.length) {
		console.log(
			`[import:legacy-procomun] ${incomplete.length} entradas incompletas (falta .json o .elpx): ${incomplete.join(", ")}`,
		);
	}

	assertLegacyCategoryDestinations();

	const records: RecordOutcome[] = [];
	const educationalNotes: EducationalImportResourceNote[] = [];
	let processed = 0;
	let imported = 0;
	let importedAsDraft = 0;
	let importedValidated = 0;
	let certifiedAsDraft = 0;
	let skippedExisting = 0;
	let blocked = 0;
	let errored = 0;

	// #420: el sello solo lo llevan los certificados que entran publicados.
	const countCertified = (resource: {
		certified: boolean;
		editorialStatus: "published" | "draft";
	}) => {
		if (!resource.certified) return;
		if (resource.editorialStatus === "published") importedValidated++;
		else certifiedAsDraft++;
	};

	// Streaming: se itera par a par (ver iterateResolvedPairs) y se corta en
	// cuanto --only encuentra su objetivo o --limit alcanza su cupo, sin haber
	// leído ni parseado los ficheros restantes del directorio.
	for await (const resolved of iterateResolvedPairs(
		allPairs,
		deps.resolveLegacyExternalId,
	)) {
		if (options.only && resolved.externalId !== options.only) continue;

		processed++;

		if (resolved.parseError) {
			errored++;
			records.push({
				outcome: "error",
				externalId: resolved.externalId,
				code: "invalid_record",
				message: `No se pudo leer/parsear el JSON: ${resolved.parseError}`,
			});
			console.error(
				`[error] ${resolved.externalId}: no se pudo leer/parsear el JSON: ${resolved.parseError}`,
			);
			if (options.only) break;
			if (options.limit != null && processed >= options.limit) break;
			continue;
		}

		const { pair } = resolved;
		// biome-ignore lint/style/noNonNullAssertion: !parseError garantiza json presente (ver iterateResolvedPairs)
		const json = resolved.json!;
		const elpxFilename = path.basename(pair.elpxPath);

		let mapping: ReturnType<typeof deps.mapLegacyRecord> | undefined;
		try {
			mapping = deps.mapLegacyRecord(json, elpxFilename);
		} catch (err) {
			errored++;
			const summary = summarizeImportError(err, "invalid_record");
			records.push({
				outcome: "error",
				externalId: resolved.externalId,
				...summary,
			});
			console.error(
				`[error] ${resolved.externalId}: ${formatImportError(summary)}`,
			);
		}

		if (mapping) {
			const warningMessages = mapping.warnings.map(
				(w) => `${w.field}: ${w.message}`,
			);

			if (mapping.blocking) {
				blocked++;
				records.push({
					outcome: "blocked",
					externalId: mapping.externalId || pair.baseName,
					reasons: mapping.blockingErrors,
				});
				console.log(
					`[bloqueado] ${pair.baseName}: ${mapping.blockingErrors.join("; ")}`,
				);
			} else {
				const existing = await deps.repo.findLegacyResourceByExternalId(
					db,
					mapping.resource.importSource,
					mapping.externalId,
				);
				if (existing) {
					skippedExisting++;
					records.push({
						outcome: "skipped_existing",
						externalId: mapping.externalId,
					});
					console.log(
						`[omitido] ${mapping.externalId}: ya importado (resourceId=${existing.id})`,
					);
				} else if (options.dryRun) {
					imported++;
					if (mapping.resource.editorialStatus === "draft") importedAsDraft++;
					countCertified(mapping.resource);
					educationalNotes.push({
						externalId: mapping.externalId,
						sourceCategories: mapping.resource.levels,
						language: mapping.resource.language,
					});
					records.push({
						outcome: "would_import",
						externalId: mapping.externalId,
						warnings: warningMessages,
						editorialStatus: mapping.resource.editorialStatus,
						sourcePublished: mapping.resource.sourcePublished,
						certified: mapping.resource.certified,
					});
				} else {
					await persistImportedResource({
						deps,
						db,
						config,
						pair,
						elpxFilename,
						mapping,
						warningMessages,
						systemUser,
						records,
						onImported: () => {
							imported++;
							if (mapping.resource.editorialStatus === "draft")
								importedAsDraft++;
							countCertified(mapping.resource);
							educationalNotes.push({
								externalId: mapping.externalId,
								sourceCategories: mapping.resource.levels,
								language: mapping.resource.language,
							});
						},
						onErrored: () => errored++,
					});
				}
			}
		}

		if (options.only) break;
		if (options.limit != null && processed >= options.limit) break;
	}

	return {
		runId,
		sourceDir: options.sourceDir,
		dryRun: options.dryRun,
		startedAt,
		finishedAt: new Date().toISOString(),
		totals: {
			pairsFound: allPairs.length,
			incompletePairs: incomplete.length,
			processed,
			imported,
			importedAsDraft,
			importedValidated,
			certifiedAsDraft,
			skippedExisting,
			blocked,
			errored,
		},
		incompletePairs: incomplete,
		records,
		categorizacionEducativa: summarizeLegacyEducationalImport(educationalNotes),
	};
}

/**
 * Promociona el directorio de extracción privado por uploadId a su ruta
 * pública final por checksum. Se llama SIEMPRE después de que la fila en BD
 * ya esté confirmada (ver comentario en persistImportedResource), así que un
 * directorio ya presente en `finalPath` solo puede ser basura huérfana de una
 * ejecución anterior interrumpida entre su propio commit y su propio rename
 * — nunca de un competidor legítimo, porque la restricción UNIQUE de
 * `elpx_projects.hash` garantiza que nunca hay dos filas con el mismo
 * checksum. Por eso es seguro reclamarlo (borrarlo) y reintentar una vez.
 */
async function promoteElpxExtractionPath(
	stagingPath: string,
	finalPath: string,
): Promise<void> {
	try {
		await rename(stagingPath, finalPath);
	} catch (err) {
		const code = (err as { code?: string })?.code;
		if (code !== "ENOTEMPTY" && code !== "EEXIST") throw err;
		await rm(finalPath, { recursive: true, force: true });
		await rename(stagingPath, finalPath);
	}
}

/**
 * Copia el `.elpx` a storage, calcula su checksum y lo persiste. Aislado en
 * su propia función para mantener legible el bucle principal de
 * `runImportLegacyProcomun`.
 */
async function persistImportedResource(params: {
	deps: Deps;
	db: ReturnType<Deps["getDb"]>["db"];
	config: ReturnType<Deps["getUploadConfig"]>;
	pair: PairedSource;
	elpxFilename: string;
	mapping: ReturnType<Deps["mapLegacyRecord"]>;
	warningMessages: string[];
	systemUser: { id: string } | null;
	records: RecordOutcome[];
	onImported: () => void;
	onErrored: () => void;
}): Promise<void> {
	const {
		deps,
		db,
		config,
		pair,
		elpxFilename,
		mapping,
		warningMessages,
		systemUser,
		records,
		onImported,
		onErrored,
	} = params;

	const uploadId = crypto.randomUUID();
	const storagePath = path.join(config.storageDir, uploadId);
	let processed: Awaited<ReturnType<typeof deps.processElpxUpload>> | undefined;
	try {
		await Bun.write(storagePath, Bun.file(pair.elpxPath));
		const [checksum, fileStat] = await Promise.all([
			deps.computeFileSha256(storagePath),
			stat(storagePath),
		]);

		// Comprobación previa (optimización, NO la única defensa — ver más abajo):
		// evita gastar trabajo de extracción para contenido ya conocido en el
		// caso común y secuencial. Bajo concurrencia real esta comprobación por
		// sí sola no basta (TOCTOU): dos ejecuciones podrían pasarla ambas antes
		// de que cualquiera persista. La defensa real es la restricción UNIQUE
		// de `elpx_projects.hash` en la inserción de más abajo.
		const existingElpxProject = await deps.repo.getElpxProjectByHash(
			db,
			checksum,
		);
		if (existingElpxProject) {
			throw new Error(
				`El .elpx tiene el mismo contenido (hash ${checksum}) que un recurso ya importado (resourceId=${existingElpxProject.resourceId}); no se vuelve a extraer.`,
			);
		}

		// Se extrae a una ruta privada por uploadId (único por intento, ver
		// crypto.randomUUID() más abajo), NO directamente al checksum: dos
		// intentos concurrentes con el mismo .elpx (incluso si ambos superan la
		// comprobación previa por una carrera) extraen siempre en directorios
		// distintos, así que nunca pueden pisarse durante la extracción.
		processed = await deps.processElpxUpload(storagePath, config.storageDir, {
			hash: uploadId,
		});

		// `elpx.hash` (el checksum) es el identificador público de la preview
		// (`/api/v1/elpx/<hash>/`, ver preview.ts y elpx-content.ts), que
		// resuelve el fichero buscando directamente `storageDir/elpx/<hash>` —
		// igual que en el resto de flujos de subida (uploads.ts, admin/elpx.ts),
		// donde el directorio físico y `elpx.hash` son siempre el mismo valor.
		// Se persiste ya como ruta final aunque la promoción física (rename, ver
		// más abajo) todavía no haya ocurrido: es la restricción UNIQUE de esta
		// inserción, no el rename, la que decide atómica y recuperablemente
		// quién es el dueño legítimo de este checksum (ver P1, revisión #268,
		// 2026-07-16 — con el rename como árbitro, un proceso interrumpido justo
		// después de ganarlo pero antes de confirmar en BD dejaba un directorio
		// huérfano en la ruta final que bloqueaba cualquier reimportación futura
		// del mismo contenido sin intervención manual).
		const finalExtractPath = deps.buildElpxPath(config.storageDir, checksum);

		// #409: la imagen preview se copia a nuestro almacenamiento. Si no se
		// puede, el recurso entra sin miniatura en vez de enlazar la remota.
		let previewImageUrl: string | null = null;
		if (mapping.resource.previewImageUrl) {
			const copied = await deps.copyLegacyPreviewImage(
				mapping.resource.previewImageUrl,
				{ storageDir: config.storageDir },
			);
			if (copied.ok) previewImageUrl = copied.url;
			else
				warningMessages.push(
					`preview: no se copia la imagen ${mapping.resource.previewImageUrl} (${copied.reason})`,
				);
		}

		const result = await deps.repo.importLegacyResourceWithElpx(db, {
			resource: {
				...mapping.resource,
				previewImageUrl,
				// mapping.blocking === false garantiza license !== null (ver field-mapper.ts)
				license: mapping.resource.license as string,
			},
			elpx: {
				hash: checksum,
				extractPath: finalExtractPath,
				originalFilename: elpxFilename,
				hasPreview: processed.hasPreview,
				hasScreenshot: processed.hasScreenshot,
				elpxMetadata: processed.metadata,
			},
			media: {
				uploadId,
				// biome-ignore lint/style/noNonNullAssertion: systemUser existe siempre fuera de dry-run
				ownerId: systemUser!.id,
				fileSize: fileStat.size,
				mimeType: "application/zip",
				url: deps.buildUploadPublicUrl(uploadId),
				storageKey: `legacy-import/${uploadId}/${deps.sanitizeFilename(elpxFilename)}`,
				finalChecksum: checksum,
			},
		});

		// A partir de aquí el recurso YA está persistido (la
		// inserción de arriba confirmó que somos los únicos dueños de este
		// checksum): cualquier fallo en los pasos siguientes es best-effort — se
		// registra como warning, nunca como "error" de todo el registro, porque
		// una reejecución no volverá a intentarlo (findLegacyResourceByExternalId
		// ya lo encontrará como importado).
		try {
			await promoteElpxExtractionPath(processed.extractPath, finalExtractPath);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			warningMessages.push(
				`preview: no se pudo promocionar el directorio de extracción a su ruta final (${message}); el contenido sigue en ${processed.extractPath}`,
			);
			console.error(
				`[warning] ${mapping.externalId}: fallo al promocionar extractPath: ${message}`,
			);
		}

		// Indexación best-effort: un fallo aquí no invalida la importación (el
		// recurso ya está persistido), solo queda temporalmente
		// fuera de la búsqueda pública hasta un `fts:reindex` manual.
		try {
			await deps.updateSearchVector(db, result.resourceId);
		} catch (err) {
			// Solo usa la base de datos: nunca se copia el mensaje (#488).
			const message = formatImportError(summarizeDbStepError(err));
			warningMessages.push(
				`search_vector: no se pudo indexar para búsqueda (${message}); ejecutar fts:reindex manualmente`,
			);
			console.error(
				`[warning] ${mapping.externalId}: fallo al indexar search_vector: ${message}`,
			);
		}

		onImported();
		records.push({
			outcome: "imported",
			externalId: mapping.externalId,
			resourceId: result.resourceId,
			warnings: warningMessages,
			editorialStatus: mapping.resource.editorialStatus,
			sourcePublished: mapping.resource.sourcePublished,
			certified: mapping.resource.certified,
		});
		console.log(
			`[importado] ${mapping.externalId} -> ${result.resourceId} (${mapping.resource.editorialStatus})` +
				`${warningMessages.length ? ` (${warningMessages.length} warnings)` : ""}`,
		);
	} catch (err) {
		onErrored();
		// Mezcla ficheros y base de datos: los mensajes propios (ZIP no válido,
		// hash repetido) se conservan; los de la base de datos, no (#488).
		const summary = summarizeImportError(err, "import_error");
		records.push({
			outcome: "error",
			externalId: mapping.externalId,
			...summary,
		});
		console.error(
			`[error] ${mapping.externalId}: ${formatImportError(summary)}`,
		);
		// No aborta el lote: el fichero copiado a storage se limpia best-effort.
		await unlink(storagePath).catch(() => {});

		// Seguro incondicionalmente: si se llega aquí, la inserción en BD nunca
		// se confirmó (si lo hubiera hecho, cualquier fallo posterior se trata
		// como warning más arriba, no como excepción de este catch), así que
		// `processed.extractPath` sigue siendo la ruta privada por uploadId de
		// ESTE intento, que ningún otro intento puede compartir ni haber tocado.
		if (processed) {
			await deps.removeElpxExtraction(processed.extractPath).catch(() => {});
		}
	}
}
