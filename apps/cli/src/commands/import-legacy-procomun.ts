/**
 * CLI command: importa recursos legacy de Procomún (pares <id>.json + <id>.elpx)
 * a procomun-ng, de forma idempotente (ver ADR-0029 y
 * docs/epics/epic-004-migracion-legacy-procomun/).
 *
 * Uso:
 *   bun run apps/cli/src/index.ts import:legacy-procomun --source-dir <ruta> [--dry-run] [--limit <n>] [--only <externalId>] [--report-dir <ruta>]
 */
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

export async function loadImportLegacyProcomunDependencies() {
	const [
		{ getDb, waitForDb },
		{ processElpxUpload },
		{ getUploadConfig, ensureUploadStorageDir, computeFileSha256, buildUploadPublicUrl, sanitizeFilename },
		legacyImport,
		repo,
	] = await Promise.all([
		import("../../../api/src/db.ts"),
		import("../../../api/src/services/elpx-processor.ts"),
		import("../../../api/src/uploads/config.ts"),
		import("@procomun/db/legacy-import"),
		import("@procomun/db/repository"),
	]);

	return {
		getDb,
		waitForDb,
		processElpxUpload,
		getUploadConfig,
		ensureUploadStorageDir,
		computeFileSha256,
		buildUploadPublicUrl,
		sanitizeFilename,
		mapLegacyRecord: legacyImport.mapLegacyRecord,
		ensureLegacyImportSystemUser: legacyImport.ensureLegacyImportSystemUser,
		repo,
	};
}

interface PairedSource {
	/** Nombre base del fichero, usado para emparejar --only (en los datos legacy observados coincide con idODE) */
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
	for (const [baseName, record] of [...byBase.entries()].sort(([a], [b]) => a.localeCompare(b))) {
		if (record.json && record.elpx) {
			pairs.push({ baseName, jsonPath: record.json, elpxPath: record.elpx });
		} else {
			incomplete.push(baseName);
		}
	}

	return { pairs, incomplete };
}

type RecordOutcome =
	| { outcome: "imported"; externalId: string; resourceId: string; warnings: string[] }
	| { outcome: "would_import"; externalId: string; warnings: string[] }
	| { outcome: "skipped_existing"; externalId: string }
	| { outcome: "blocked"; externalId: string; reasons: string[] }
	| { outcome: "error"; externalId: string; message: string };

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
		skippedExisting: number;
		blocked: number;
		errored: number;
	};
	incompletePairs: string[];
	records: RecordOutcome[];
}

function parseCliArgs(args: string[]) {
	const { values } = parseArgs({
		args,
		options: {
			"source-dir": { type: "string" },
			"dry-run": { type: "boolean", default: false },
			limit: { type: "string" },
			only: { type: "string" },
			"report-dir": { type: "string" },
		},
		strict: true,
	});

	if (!values["source-dir"]) {
		throw new Error(
			"Falta --source-dir. Uso: import:legacy-procomun --source-dir <ruta> [--dry-run] [--limit <n>] [--only <externalId>] [--report-dir <ruta>]",
		);
	}

	const limit = values.limit != null ? Number(values.limit) : undefined;
	if (limit != null && (!Number.isFinite(limit) || limit <= 0)) {
		throw new Error(`--limit inválido: ${values.limit}`);
	}

	return {
		sourceDir: path.resolve(values["source-dir"]),
		dryRun: Boolean(values["dry-run"]),
		limit,
		only: values.only,
		reportDir: path.resolve(
			values["report-dir"] ?? path.join(import.meta.dir, "../../../../local-data/legacy-import-reports"),
		),
	};
}

export async function importLegacyProcomun(args: string[]) {
	const options = parseCliArgs(args);
	const deps = await loadImportLegacyProcomunDependencies();

	const report = await runImportLegacyProcomun(options, deps);

	await mkdir(options.reportDir, { recursive: true });
	const reportPath = path.join(
		options.reportDir,
		`informe_ingesta-${options.dryRun ? "dryrun-" : ""}${report.runId}.json`,
	);
	await Bun.write(reportPath, JSON.stringify(report, null, 2));
	console.log(`[import:legacy-procomun] Informe escrito en ${reportPath}`);

	console.log(
		`[import:legacy-procomun] Completado. ${options.dryRun ? "(dry-run) " : ""}` +
			`importados=${report.totals.imported} omitidos_ya_existentes=${report.totals.skippedExisting} ` +
			`bloqueados=${report.totals.blocked} errores=${report.totals.errored} incompletos=${report.totals.incompletePairs}`,
	);

	// Calculado ANTES de cerrar la conexión: el runtime WASM de PGlite puede
	// mutar process.exitCode de forma asíncrona en background (ver comentario
	// más abajo), así que no hay que confiar en su valor en este punto.
	const exitCode = report.totals.errored > 0 ? 1 : 0;

	// La conexión PGlite compartida (apps/api/src/db.ts) está pensada para un
	// proceso servidor de larga vida y nunca se cierra explícitamente. En un
	// script de un solo uso como este CLI, el runtime WASM/Emscripten de
	// PGlite detecta que el proceso Node/Bun va a terminar sin haber cerrado
	// limpiamente su instancia y fija `process.exitCode = 99` como red de
	// seguridad (ver quit_() en @electric-sql/pglite) — reproducible incluso
	// llamando a process.exit(0) explícitamente. Cerrar el cliente antes de
	// salir evita esa ruta y deja el código de salida real (0/1).
	const client = deps.getDb().db.$client as { close?: () => unknown } | undefined;
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
 * Núcleo del importador, separado de `importLegacyProcomun` (que gestiona
 * args de CLI y escritura del informe) para poder testear el flujo completo
 * inyectando dependencias sin pasar por `process.exit`/parseArgs.
 */
export async function runImportLegacyProcomun(
	options: { sourceDir: string; dryRun: boolean; limit?: number; only?: string },
	deps: Awaited<ReturnType<typeof loadImportLegacyProcomunDependencies>>,
): Promise<ImportLegacyProcomunReport> {
	const startedAt = new Date().toISOString();
	const runId = crypto.randomUUID();

	await deps.waitForDb();
	const db = deps.getDb().db;
	const config = deps.getUploadConfig();

	if (!options.dryRun) {
		await deps.ensureUploadStorageDir(config);
	}
	const systemUser = options.dryRun ? null : await deps.ensureLegacyImportSystemUser(db);

	const { pairs: allPairs, incomplete } = await findLegacySourcePairs(options.sourceDir);
	let pairs = allPairs;
	if (options.only) pairs = pairs.filter((p) => p.baseName === options.only);
	if (options.limit != null) pairs = pairs.slice(0, options.limit);

	console.log(
		`[import:legacy-procomun] ${allPairs.length} pares encontrados en ${options.sourceDir}` +
			`${options.dryRun ? " (dry-run)" : ""}, procesando ${pairs.length}...`,
	);
	if (incomplete.length) {
		console.log(
			`[import:legacy-procomun] ${incomplete.length} entradas incompletas (falta .json o .elpx): ${incomplete.join(", ")}`,
		);
	}

	const records: RecordOutcome[] = [];
	let imported = 0;
	let skippedExisting = 0;
	let blocked = 0;
	let errored = 0;

	for (const pair of pairs) {
		const json = await Bun.file(pair.jsonPath).json();
		const elpxFilename = path.basename(pair.elpxPath);
		const mapping = deps.mapLegacyRecord(json, elpxFilename);
		const warningMessages = mapping.warnings.map((w) => `${w.field}: ${w.message}`);

		if (mapping.blocking) {
			blocked++;
			records.push({
				outcome: "blocked",
				externalId: mapping.externalId || pair.baseName,
				reasons: mapping.blockingErrors,
			});
			console.log(`[bloqueado] ${pair.baseName}: ${mapping.blockingErrors.join("; ")}`);
			continue;
		}

		const existing = await deps.repo.findLegacyResourceByExternalId(
			db,
			mapping.resource.importSource,
			mapping.externalId,
		);
		if (existing) {
			skippedExisting++;
			records.push({ outcome: "skipped_existing", externalId: mapping.externalId });
			console.log(`[omitido] ${mapping.externalId}: ya importado (resourceId=${existing.id})`);
			continue;
		}

		if (options.dryRun) {
			imported++;
			records.push({ outcome: "would_import", externalId: mapping.externalId, warnings: warningMessages });
			continue;
		}

		const uploadId = crypto.randomUUID();
		const storagePath = path.join(config.storageDir, uploadId);
		try {
			await Bun.write(storagePath, Bun.file(pair.elpxPath));
			const [checksum, fileStat, processed] = await Promise.all([
				deps.computeFileSha256(storagePath),
				stat(storagePath),
				deps.processElpxUpload(storagePath, config.storageDir),
			]);

			const result = await deps.repo.importLegacyResourceWithElpx(db, {
				resource: {
					...mapping.resource,
					// mapping.blocking === false garantiza license !== null (ver field-mapper.ts)
					license: mapping.resource.license as string,
				},
				elpx: {
					hash: processed.hash,
					extractPath: processed.extractPath,
					originalFilename: elpxFilename,
					hasPreview: processed.hasPreview,
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

			imported++;
			records.push({
				outcome: "imported",
				externalId: mapping.externalId,
				resourceId: result.resourceId,
				warnings: warningMessages,
			});
			console.log(
				`[importado] ${mapping.externalId} -> ${result.resourceId}` +
					`${warningMessages.length ? ` (${warningMessages.length} warnings)` : ""}`,
			);
		} catch (err) {
			errored++;
			const message = err instanceof Error ? err.message : String(err);
			records.push({ outcome: "error", externalId: mapping.externalId, message });
			console.error(`[error] ${mapping.externalId}: ${message}`);
			// No aborta el lote: el fichero copiado a storage se limpia best-effort.
			await unlink(storagePath).catch(() => {});
		}
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
			processed: pairs.length,
			imported,
			skippedExisting,
			blocked,
			errored,
		},
		incompletePairs: incomplete,
		records,
	};
}
