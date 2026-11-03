/**
 * Importa el JSON de usuarios generado por el exportador legacy de Procomún
 * (issue #456): cuenta, rol, hash de contraseña antiguo (se cambia al formato
 * nuevo en el primer inicio de sesión) y perfil. Los bloqueados (`status: 0`)
 * se crean bloqueados y se cuentan en el informe. No enlaza todavía los
 * recursos con su propietario ni importa fotos.
 *
 * Uso:
 *   bun run apps/cli/src/index.ts import:legacy-users --source-file <usuarios.json> [--dry-run] [--limit <n>] [--report-dir <ruta>]
 *   bun run apps/cli/src/index.ts import:legacy-users --fix-roles --source-file <usuarios.json> [--dry-run] [--limit <n>] [--report-dir <ruta>]
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
		fixLegacyUserRole: repo.fixLegacyUserRole,
	};
}

type Deps = Awaited<ReturnType<typeof loadImportLegacyUsersDependencies>>;

type RecordOutcome =
	| {
			outcome: "imported";
			legacyUid: string;
			userId: string;
			role: MappedLegacyUser["role"];
			blocked: boolean;
			warnings: string[];
	  }
	| {
			outcome: "would_import";
			legacyUid: string;
			userId: string;
			role: MappedLegacyUser["role"];
			blocked: boolean;
			warnings: string[];
	  }
	| {
			outcome: "skipped_existing_id";
			legacyUid: string;
			userId: string;
			completed?: Array<"password" | "profile">;
	  }
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
		wouldImport: number;
		skippedExistingId: number;
		skippedExistingEmail: number;
		errored: number;
		/** Cuentas nuevas con `status: 0`: entran bloqueadas. */
		importedBlocked: number;
		/** Cuentas nuevas sin hash admitido: tendrán que recuperar la contraseña. */
		withoutPassword: number;
	};
	/** Roles del origen sin correspondencia (entran como editor, #507). */
	unknownRoles: UnknownRolesSummary;
	records: RecordOutcome[];
}

type UnknownRolesSummary = Array<{
	role: string;
	count: number;
	legacyUids: string[];
}>;

export function parseImportLegacyUsersArgs(args: string[]) {
	const { values } = parseArgs({
		args,
		options: {
			"source-file": { type: "string" },
			"fix-roles": { type: "boolean", default: false },
			"dry-run": { type: "boolean", default: false },
			limit: { type: "string" },
			"report-dir": { type: "string" },
		},
		strict: true,
	});
	if (!values["source-file"]) {
		throw new Error(
			"Falta --source-file. Uso: import:legacy-users [--fix-roles] --source-file <usuarios.json> [--dry-run] [--limit <n>] [--report-dir <ruta>]",
		);
	}
	const limit = values.limit == null ? undefined : Number(values.limit);
	if (limit != null && (!Number.isInteger(limit) || limit <= 0)) {
		throw new Error(`--limit inválido: ${values.limit}`);
	}
	return {
		sourceFile: path.resolve(values["source-file"]),
		fixRoles: Boolean(values["fix-roles"]),
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

function addUnknownRoles(
	unknownRoles: Map<string, string[]>,
	mapped: MappedLegacyUser,
) {
	for (const role of mapped.unknownRoles) {
		unknownRoles.set(role, [
			...(unknownRoles.get(role) ?? []),
			mapped.legacyUid,
		]);
	}
}

function summarizeUnknownRoles(
	unknownRoles: Map<string, string[]>,
): UnknownRolesSummary {
	return [...unknownRoles].map(([role, legacyUids]) => ({
		role,
		count: legacyUids.length,
		legacyUids,
	}));
}

function logUnknownRoles(unknownRoles: UnknownRolesSummary) {
	if (unknownRoles.length === 0) return;
	console.log(
		`[import:legacy-users] Roles sin correspondencia (entran como editor): ${unknownRoles
			.map((entry) => `${entry.role} (${entry.count})`)
			.join(", ")}`,
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
	const options = parseImportLegacyUsersArgs(args);
	const deps = await loadImportLegacyUsersDependencies();
	const exitCode = await runImportLegacyUsersCommand(options, deps);
	process.exit(exitCode);
}

export async function runImportLegacyUsersCommand(
	options: ReturnType<typeof parseImportLegacyUsersArgs>,
	deps: Deps,
): Promise<number> {
	try {
		if (options.fixRoles) return await runFixRolesCommand(options, deps);
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
				`${options.dryRun ? "importables" : "importados"}=${options.dryRun ? report.totals.wouldImport : report.totals.imported} ` +
				`omitidos_id=${report.totals.skippedExistingId} omitidos_email=${report.totals.skippedExistingEmail} errores=${report.totals.errored} ` +
				`bloqueados=${report.totals.importedBlocked} sin_contraseña=${report.totals.withoutPassword}`,
		);
		logUnknownRoles(report.unknownRoles);
		return report.totals.errored > 0 ? 1 : 0;
	} finally {
		await closeCliDb(deps.getDb().db);
	}
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
	let wouldImport = 0;
	let skippedExistingId = 0;
	let skippedExistingEmail = 0;
	let errored = 0;
	let importedBlocked = 0;
	let withoutPassword = 0;
	const unknownRoles = new Map<string, string[]>();
	const plannedIds = new Map<string, string>();
	const plannedEmails = new Map<string, string>();
	const users = raw.slice(0, options.limit) as LegacyUserJson[];

	for (const [index, legacy] of users.entries()) {
		try {
			const mapped = deps.mapLegacyUser(legacy);
			const warnings = warningMessages(mapped);
			const counted = () => {
				if (mapped.blocked) importedBlocked++;
				if (!mapped.passwordHash) withoutPassword++;
				addUnknownRoles(unknownRoles, mapped);
			};
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
				wouldImport++;
				counted();
				records.push({
					outcome: "would_import",
					legacyUid: mapped.legacyUid,
					userId: mapped.id,
					role: mapped.role,
					blocked: mapped.blocked,
					warnings,
				});
				continue;
			}

			const result = await deps.importLegacyUser(db, mapped);
			if (result.outcome === "imported") {
				imported++;
				counted();
				records.push({
					outcome: "imported",
					legacyUid: mapped.legacyUid,
					userId: result.id,
					role: mapped.role,
					blocked: mapped.blocked,
					warnings,
				});
			} else if (result.outcome === "skipped_existing_id") {
				skippedExistingId++;
				records.push({
					outcome: result.outcome,
					legacyUid: mapped.legacyUid,
					userId: result.id,
					...(result.completed ? { completed: result.completed } : {}),
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
			wouldImport,
			skippedExistingId,
			skippedExistingEmail,
			errored,
			importedBlocked,
			withoutPassword,
		},
		unknownRoles: summarizeUnknownRoles(unknownRoles),
		records,
	};
}

type FixRolesRecord =
	| {
			outcome: "fixed" | "would_fix";
			legacyUid: string;
			userId: string;
			from: "author";
			to: "editor";
	  }
	| {
			outcome: "kept";
			legacyUid: string;
			userId: string;
			role: string;
			mappedRole: MappedLegacyUser["role"];
	  }
	| { outcome: "not_found"; legacyUid: string; userId: string }
	| { outcome: "error"; index: number; message: string };

export interface FixLegacyUserRolesReport {
	runId: string;
	sourceFile: string;
	dryRun: boolean;
	startedAt: string;
	finishedAt: string;
	totals: {
		found: number;
		processed: number;
		/** author → editor (en dry-run, los que se corregirían). */
		fixed: number;
		/** Ya tienen el rol que da el mapeo. */
		unchanged: number;
		/** Otro rol (admin, curator o puesto a mano): no se toca. */
		kept: number;
		/** Sin cuenta legacy con ese uid. */
		notFound: number;
		errored: number;
	};
	/** Roles del origen sin correspondencia (entran como editor). */
	unknownRoles: UnknownRolesSummary;
	/** Sin los `unchanged`: esos solo se cuentan. */
	records: FixRolesRecord[];
}

async function runFixRolesCommand(
	options: ReturnType<typeof parseImportLegacyUsersArgs>,
	deps: Deps,
): Promise<number> {
	const report = await runFixLegacyUserRoles(options, deps);
	await mkdir(options.reportDir, { recursive: true });
	const reportPath = path.join(
		options.reportDir,
		`informe_usuarios-correccion-roles-${options.dryRun ? "dryrun-" : ""}${report.runId}.json`,
	);
	await Bun.write(reportPath, JSON.stringify(report, null, 2));
	console.log(`[import:legacy-users] Informe escrito en ${reportPath}`);
	const t = report.totals;
	console.log(
		`[import:legacy-users] Completado. ${options.dryRun ? "(dry-run) " : ""}` +
			`revisados=${t.processed} a_editor=${t.fixed} sin_cambios=${t.unchanged} ` +
			`respetados=${t.kept} no_importados=${t.notFound} errores=${t.errored}`,
	);
	logUnknownRoles(report.unknownRoles);
	return t.errored > 0 ? 1 : 0;
}

/**
 * `--fix-roles` (issue #507): hasta esa corrección los usuarios autenticados,
 * sin rol, documentalistas, gestores de ODEs y desconocidos entraban como
 * `author`, y reimportar no cambia el rol de una cuenta existente. Esta pasada
 * relee el JSON, aplica el mapeo vigente y pasa a `editor` las cuentas legacy
 * que siguen en `author` (ver fixLegacyUserRole). No toca admin, curator,
 * otros roles ni cuentas que no sean `legacy-procomun:user:<uid>`.
 */
export async function runFixLegacyUserRoles(
	options: { sourceFile: string; dryRun: boolean; limit?: number },
	deps: Deps,
): Promise<FixLegacyUserRolesReport> {
	const startedAt = new Date().toISOString();
	const raw = await Bun.file(options.sourceFile).json();
	if (!Array.isArray(raw)) {
		throw new Error("El JSON de usuarios debe contener un array en la raíz");
	}

	await deps.waitForDb();
	const db = deps.getDb().db;
	const users = raw.slice(0, options.limit) as LegacyUserJson[];
	const totals = {
		found: raw.length,
		processed: users.length,
		fixed: 0,
		unchanged: 0,
		kept: 0,
		notFound: 0,
		errored: 0,
	};
	const unknownRoles = new Map<string, string[]>();
	const records: FixRolesRecord[] = [];

	for (const [index, legacy] of users.entries()) {
		try {
			const mapped = deps.mapLegacyUser(legacy);
			addUnknownRoles(unknownRoles, mapped);
			const trace = { legacyUid: mapped.legacyUid, userId: mapped.id };
			const result = await deps.fixLegacyUserRole(db, mapped, {
				dryRun: options.dryRun,
			});
			if (result.outcome === "fixed") {
				totals.fixed++;
				records.push({
					outcome: options.dryRun ? "would_fix" : "fixed",
					...trace,
					from: result.from,
					to: result.to,
				});
				console.log(
					`[a editor${options.dryRun ? " (dry-run)" : ""}] ${mapped.id}`,
				);
			} else if (result.outcome === "unchanged") {
				totals.unchanged++;
			} else if (result.outcome === "kept") {
				totals.kept++;
				records.push({
					outcome: "kept",
					...trace,
					role: result.role,
					mappedRole: mapped.role,
				});
			} else {
				totals.notFound++;
				records.push({ outcome: "not_found", ...trace });
			}
		} catch (error) {
			totals.errored++;
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
		totals,
		unknownRoles: summarizeUnknownRoles(unknownRoles),
		records,
	};
}
