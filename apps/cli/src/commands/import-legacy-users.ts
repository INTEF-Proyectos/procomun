/**
 * Importa el JSON de usuarios generado por el exportador legacy de Procomún.
 * No migra hashes Drupal ni asociaciones con recursos.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import type {
	LegacyUserJson,
	MappedLegacyUser,
} from "@procomun/db/legacy-import";

export async function loadImportLegacyUsersDependencies() {
	const [{ getDb, waitForDb }, legacyImport, repo] = await Promise.all([
		import("../../../api/src/db.ts"),
		import("@procomun/db/legacy-import"),
		import("@procomun/db/repository"),
	]);

	return {
		getDb,
		waitForDb,
		mapLegacyUser: legacyImport.mapLegacyUser,
		findLegacyUserImportConflict: repo.findLegacyUserImportConflict,
		importLegacyUser: repo.importLegacyUser,
	};
}

type Deps = Awaited<ReturnType<typeof loadImportLegacyUsersDependencies>>;

type RecordOutcome =
	| {
			outcome: "imported";
			legacyUid: string;
			userId: string;
			warnings: string[];
	  }
	| {
			outcome: "would_import";
			legacyUid: string;
			userId: string;
			warnings: string[];
	  }
	| { outcome: "skipped_existing_id"; legacyUid: string; userId: string }
	| { outcome: "skipped_existing_email"; legacyUid: string; userId: string }
	| { outcome: "error"; index: number; message: string };

export interface ImportLegacyUsersReport {
	runId: string;
	sourceFile: string;
	dryRun: boolean;
	startedAt: string;
	finishedAt: string;
	totals: {
		found: number;
		processed: number;
		imported: number;
		skippedExistingId: number;
		skippedExistingEmail: number;
		errored: number;
	};
	records: RecordOutcome[];
}

function parseCliArgs(args: string[]) {
	const { values } = parseArgs({
		args,
		options: {
			"source-file": { type: "string" },
			"dry-run": { type: "boolean", default: false },
			limit: { type: "string" },
			"report-dir": { type: "string" },
		},
		strict: true,
	});
	if (!values["source-file"]) {
		throw new Error(
			"Falta --source-file. Uso: import:legacy-users --source-file <usuarios.json> [--dry-run] [--limit <n>] [--report-dir <ruta>]",
		);
	}
	const limit = values.limit == null ? undefined : Number(values.limit);
	if (limit != null && (!Number.isInteger(limit) || limit <= 0)) {
		throw new Error(`--limit inválido: ${values.limit}`);
	}
	return {
		sourceFile: path.resolve(values["source-file"]),
		dryRun: Boolean(values["dry-run"]),
		limit,
		reportDir: path.resolve(
			values["report-dir"] ??
				path.join(
					import.meta.dir,
					"../../../../local-data/legacy-import-reports",
				),
		),
	};
}

function warningMessages(mapped: MappedLegacyUser): string[] {
	return mapped.warnings.map(
		(warning) => `${warning.field}: ${warning.message}`,
	);
}

/** Cierra PGlite en ejecuciones CLI cortas, sin acoplar el tipo Drizzle al driver. */
export async function closeCliDb(db: unknown): Promise<void> {
	if (!db || typeof db !== "object" || !("$client" in db)) return;
	const client = (db as { $client?: { close?: () => unknown } }).$client;
	if (typeof client?.close !== "function") return;
	try {
		await client.close();
	} catch {
		// El informe ya está escrito; no ocultar su resultado por un fallo al cerrar.
	}
}

export async function importLegacyUsers(args: string[]) {
	const options = parseCliArgs(args);
	const deps = await loadImportLegacyUsersDependencies();
	const report = await runImportLegacyUsers(options, deps);
	await mkdir(options.reportDir, { recursive: true });
	const reportPath = path.join(
		options.reportDir,
		`informe_usuarios-${options.dryRun ? "dryrun-" : ""}${report.runId}.json`,
	);
	await Bun.write(reportPath, JSON.stringify(report, null, 2));
	console.log(`[import:legacy-users] Informe escrito en ${reportPath}`);
	console.log(
		`[import:legacy-users] Completado. ${options.dryRun ? "(dry-run) " : ""}` +
			`importados=${report.totals.imported} omitidos_id=${report.totals.skippedExistingId} ` +
			`omitidos_email=${report.totals.skippedExistingEmail} errores=${report.totals.errored}`,
	);
	const exitCode = report.totals.errored > 0 ? 1 : 0;
	await closeCliDb(deps.getDb().db);
	process.exit(exitCode);
}

export async function runImportLegacyUsers(
	options: { sourceFile: string; dryRun: boolean; limit?: number },
	deps: Deps,
): Promise<ImportLegacyUsersReport> {
	const startedAt = new Date().toISOString();
	const raw = await Bun.file(options.sourceFile).json();
	if (!Array.isArray(raw)) {
		throw new Error("El JSON de usuarios debe contener un array en la raíz");
	}

	await deps.waitForDb();
	const db = deps.getDb().db;
	const records: RecordOutcome[] = [];
	let imported = 0;
	let skippedExistingId = 0;
	let skippedExistingEmail = 0;
	let errored = 0;
	const plannedIds = new Map<string, string>();
	const plannedEmails = new Map<string, string>();
	const users = raw.slice(0, options.limit) as LegacyUserJson[];

	for (const [index, legacy] of users.entries()) {
		try {
			const mapped = deps.mapLegacyUser(legacy);
			const warnings = warningMessages(mapped);
			if (options.dryRun) {
				const existing = await deps.findLegacyUserImportConflict(db, mapped);
				const plannedById = plannedIds.get(mapped.id);
				const plannedByEmail = plannedEmails.get(mapped.email.toLowerCase());
				const conflict =
					existing ??
					(plannedById
						? { outcome: "skipped_existing_id" as const, id: plannedById }
						: plannedByEmail
							? {
									outcome: "skipped_existing_email" as const,
									id: plannedByEmail,
								}
							: null);
				if (conflict?.outcome === "skipped_existing_id") {
					skippedExistingId++;
					records.push({
						outcome: conflict.outcome,
						legacyUid: mapped.legacyUid,
						userId: conflict.id,
					});
					continue;
				}
				if (conflict?.outcome === "skipped_existing_email") {
					skippedExistingEmail++;
					records.push({
						outcome: conflict.outcome,
						legacyUid: mapped.legacyUid,
						userId: conflict.id,
					});
					continue;
				}

				plannedIds.set(mapped.id, mapped.id);
				plannedEmails.set(mapped.email.toLowerCase(), mapped.id);
				imported++;
				records.push({
					outcome: "would_import",
					legacyUid: mapped.legacyUid,
					userId: mapped.id,
					warnings,
				});
				continue;
			}

			const result = await deps.importLegacyUser(db, mapped);
			if (result.outcome === "imported") {
				imported++;
				records.push({
					outcome: "imported",
					legacyUid: mapped.legacyUid,
					userId: result.id,
					warnings,
				});
			} else if (result.outcome === "skipped_existing_id") {
				skippedExistingId++;
				records.push({
					outcome: result.outcome,
					legacyUid: mapped.legacyUid,
					userId: result.id,
				});
			} else {
				skippedExistingEmail++;
				records.push({
					outcome: result.outcome,
					legacyUid: mapped.legacyUid,
					userId: result.id,
				});
			}
		} catch (error) {
			errored++;
			const message = error instanceof Error ? error.message : String(error);
			records.push({ outcome: "error", index, message });
			console.error(`[error] registro ${index}: ${message}`);
		}
	}

	return {
		runId: crypto.randomUUID(),
		sourceFile: options.sourceFile,
		dryRun: options.dryRun,
		startedAt,
		finishedAt: new Date().toISOString(),
		totals: {
			found: raw.length,
			processed: users.length,
			imported,
			skippedExistingId,
			skippedExistingEmail,
			errored,
		},
		records,
	};
}
