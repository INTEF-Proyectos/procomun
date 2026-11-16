/**
 * Importa los itinerarios del Procomún antiguo como colecciones (issue #432).
 * El exportador los da todos en un único JSON (un array).
 *
 * - Propietario: la cuenta cuyo correo coincide con `publicatorEmailStr`
 *   (como los recursos en #508). Sin cuenta, la colección queda en borrador a
 *   nombre del usuario de sistema del importador y sale en el informe.
 * - Recursos: los ODE (`itineraryContent`) y luego los artículos
 *   (`interestContent`), cruzados por el `external_id` con el que los guardó
 *   import:legacy-procomun. Deben importarse antes: los que falten se omiten
 *   y salen en el informe como «recurso no encontrado».
 * - Idempotente: reimportar actualiza la colección sin duplicarla y respeta
 *   el propietario reasignado a mano.
 * - knowledgeArea, labelsStr, learningContext y educationalDescription se
 *   descartan (las colecciones no tienen esos campos) y se cuentan.
 *
 * El informe no lleva correos ni nombres (#543): solo el id del itinerario, el
 * resultado y el motivo.
 *
 * Uso:
 *   bun run apps/cli/src/index.ts import:legacy-itineraries --source-file <itinerarios.json> [--dry-run] [--limit <n>] [--only <id>] [--report-dir <ruta>]
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import type {
	LegacyItineraryDiscardedField,
	LegacyItineraryJson,
} from "@procomun/db/legacy-import";
import type {
	ImportLegacyCollectionResult,
	LegacyCollectionOwnerOutcome,
	MissingLegacyCollectionResource,
} from "@procomun/db/repository";
import {
	formatImportError,
	type ImportErrorSummary,
	summarizeDbStepError,
	withoutDbDetails,
} from "../import-errors.ts";
import { closeCliDb } from "./import-legacy-users.ts";

const TAG = "[import:legacy-itineraries]";

export async function loadImportLegacyItinerariesDependencies() {
	const [{ getDb, waitForDb }, legacyImport, repo] = await Promise.all([
		import("../../../api/src/db.ts"),
		import("@procomun/db/legacy-import"),
		import("@procomun/db/repository"),
	]);

	return {
		getDb,
		waitForDb,
		mapLegacyItinerary: legacyImport.mapLegacyItinerary,
		ensureLegacyImportSystemUser: legacyImport.ensureLegacyImportSystemUser,
		findLegacyCollectionOwnerAccount: repo.findLegacyCollectionOwnerAccount,
		importLegacyCollection: repo.importLegacyCollection,
		LEGACY_USER_ID_PREFIX: repo.LEGACY_USER_ID_PREFIX,
	};
}

type Deps = Awaited<ReturnType<typeof loadImportLegacyItinerariesDependencies>>;

/** Por qué no se asigna la colección a una cuenta. Nunca lleva el correo. */
export type OwnerReason =
	| "no_email"
	| "no_account"
	| "deleted_account"
	| "unverified_account";

type ImportedRecord = {
	outcome: ImportLegacyCollectionResult["outcome"];
	itineraryId: string;
	collectionId: string | null;
	owner: LegacyCollectionOwnerOutcome;
	/** Solo si no hay cuenta a la que asignarla. */
	ownerReason?: OwnerReason;
	linkedResources: number;
	missingResources: MissingLegacyCollectionResource[];
	discardedFields: LegacyItineraryDiscardedField[];
	warnings: string[];
};

type BlockedRecord = {
	outcome: "blocked";
	index: number;
	itineraryId?: string;
	errors: string[];
};

type ErrorRecord = {
	outcome: "error";
	index: number;
	itineraryId?: string;
} & ImportErrorSummary;

export type ItineraryRecord = ImportedRecord | BlockedRecord | ErrorRecord;

export interface ImportLegacyItinerariesReport {
	runId: string;
	sourceFile: string;
	dryRun: boolean;
	startedAt: string;
	finishedAt: string;
	totals: {
		found: number;
		processed: number;
		created: number;
		updated: number;
		unchanged: number;
		wouldCreate: number;
		wouldUpdate: number;
		blocked: number;
		errored: number;
		/** Colecciones a nombre del usuario de sistema (sin cuenta del autor). */
		withoutOwner: number;
		/** Recursos del itinerario que no están importados (o están de baja). */
		missingResources: number;
		/** Registros que traían cada metadato descartado con contenido. */
		discardedMetadata: Record<LegacyItineraryDiscardedField, number>;
	};
	records: ItineraryRecord[];
}

export function parseImportLegacyItinerariesArgs(args: string[]) {
	const { values } = parseArgs({
		args,
		options: {
			"source-file": { type: "string" },
			"dry-run": { type: "boolean", default: false },
			limit: { type: "string" },
			only: { type: "string" },
			"report-dir": { type: "string" },
		},
		strict: true,
	});
	if (!values["source-file"]) {
		throw new Error(
			"Falta --source-file. Uso: import:legacy-itineraries --source-file <itinerarios.json> [--dry-run] [--limit <n>] [--only <id>] [--report-dir <ruta>]",
		);
	}
	const limit = values.limit == null ? undefined : Number(values.limit);
	if (limit != null && (!Number.isInteger(limit) || limit <= 0)) {
		throw new Error(`--limit inválido: ${values.limit}`);
	}
	const only = values.only?.trim();
	if (values.only != null && !only) {
		throw new Error("--only necesita el id de un itinerario");
	}
	return {
		sourceFile: path.resolve(values["source-file"]),
		dryRun: Boolean(values["dry-run"]),
		limit,
		only,
		reportDir: path.resolve(
			values["report-dir"] ??
				path.join(
					import.meta.dir,
					"../../../../local-data/legacy-import-reports",
				),
		),
	};
}

export async function importLegacyItineraries(args: string[]) {
	const options = parseImportLegacyItinerariesArgs(args);
	const deps = await loadImportLegacyItinerariesDependencies();
	const exitCode = await runImportLegacyItinerariesCommand(options, deps);
	process.exit(exitCode);
}

export async function runImportLegacyItinerariesCommand(
	options: ReturnType<typeof parseImportLegacyItinerariesArgs>,
	deps: Deps,
): Promise<number> {
	try {
		const report = await runImportLegacyItineraries(options, deps);
		await mkdir(options.reportDir, { recursive: true });
		const reportPath = path.join(
			options.reportDir,
			`informe_itinerarios-${options.dryRun ? "dryrun-" : ""}${report.runId}.json`,
		);
		await Bun.write(reportPath, JSON.stringify(report, null, 2));
		const t = report.totals;
		console.log(`${TAG} Informe escrito en ${reportPath}`);
		console.log(
			`${TAG} Completado. ${options.dryRun ? "(dry-run) " : ""}` +
				(options.dryRun
					? `a_crear=${t.wouldCreate} a_actualizar=${t.wouldUpdate} `
					: `creadas=${t.created} actualizadas=${t.updated} `) +
				`sin_cambios=${t.unchanged} bloqueados=${t.blocked} errores=${t.errored} ` +
				`sin_propietario=${t.withoutOwner} recursos_no_encontrados=${t.missingResources}`,
		);
		const discarded = Object.entries(t.discardedMetadata)
			.filter(([, count]) => count > 0)
			.map(([field, count]) => `${field} (${count})`);
		if (discarded.length > 0) {
			console.log(
				`${TAG} Metadatos descartados (las colecciones no los tienen): ${discarded.join(", ")}`,
			);
		}
		return t.errored > 0 || t.blocked > 0 ? 1 : 0;
	} catch (error) {
		// Lo que se escapa del bucle lo escribe entero el manejador del CLI.
		throw withoutDbDetails(error);
	} finally {
		await closeCliDb(deps.getDb().db);
	}
}

type OwnerResolution =
	| { userId: string; reason?: undefined }
	| { userId: null; reason: OwnerReason };

/**
 * `publicatorEmailStr` → cuenta, con la misma regla que #508 para los
 * recursos: las dadas de baja no reciben nada y las bloqueadas sí. Una cuenta
 * sin verificar tampoco, salvo las que crea el importador de usuarios (#488):
 * si no, quien se registre con el correo de un autor antiguo se quedaría con
 * sus colecciones. Cada correo se busca una vez por ejecución.
 */
function createOwnerResolver(deps: Deps, db: ReturnType<Deps["getDb"]>["db"]) {
	const cache = new Map<string, OwnerResolution>();
	return async (email: string | null): Promise<OwnerResolution> => {
		if (!email) return { userId: null, reason: "no_email" };
		const cached = cache.get(email);
		if (cached) return cached;
		const account = await deps.findLegacyCollectionOwnerAccount(db, email);
		const resolution: OwnerResolution = !account
			? { userId: null, reason: "no_account" }
			: account.deleted
				? { userId: null, reason: "deleted_account" }
				: !account.emailVerified &&
						!account.id.startsWith(deps.LEGACY_USER_ID_PREFIX)
					? { userId: null, reason: "unverified_account" }
					: { userId: account.id };
		cache.set(email, resolution);
		return resolution;
	};
}

const KIND_LABEL = { ode: "ODE", article: "artículo" } as const;

export async function runImportLegacyItineraries(
	options: {
		sourceFile: string;
		dryRun: boolean;
		limit?: number;
		only?: string;
	},
	deps: Deps,
): Promise<ImportLegacyItinerariesReport> {
	const startedAt = new Date().toISOString();
	const raw = await Bun.file(options.sourceFile).json();
	if (!Array.isArray(raw)) {
		throw new Error("El JSON de itinerarios debe contener un array en la raíz");
	}

	await deps.waitForDb();
	const db = deps.getDb().db;
	if (!options.dryRun) await deps.ensureLegacyImportSystemUser(db);
	const resolveOwner = createOwnerResolver(deps, db);

	const selected = raw
		.map((legacy: unknown, index: number) => ({ legacy, index }))
		.filter(
			({ legacy }) =>
				!options.only ||
				(legacy as { id?: unknown } | null)?.id === options.only,
		)
		.slice(0, options.limit);

	const totals: ImportLegacyItinerariesReport["totals"] = {
		found: raw.length,
		processed: selected.length,
		created: 0,
		updated: 0,
		unchanged: 0,
		wouldCreate: 0,
		wouldUpdate: 0,
		blocked: 0,
		errored: 0,
		withoutOwner: 0,
		missingResources: 0,
		discardedMetadata: {
			knowledgeArea: 0,
			labelsStr: 0,
			learningContext: 0,
			educationalDescription: 0,
		},
	};
	const records: ItineraryRecord[] = [];

	for (const { legacy, index } of selected) {
		const sourceId = (legacy as { id?: unknown } | null)?.id;
		const itineraryId =
			typeof sourceId === "string" && sourceId.trim()
				? sourceId.trim()
				: undefined;
		if (!legacy || typeof legacy !== "object" || Array.isArray(legacy)) {
			totals.blocked++;
			records.push({
				outcome: "blocked",
				index,
				errors: ["El registro no es un objeto"],
			});
			continue;
		}
		const { mapped, blockingErrors } = deps.mapLegacyItinerary(
			legacy as LegacyItineraryJson,
		);
		if (!mapped) {
			totals.blocked++;
			records.push({
				outcome: "blocked",
				index,
				...(itineraryId ? { itineraryId } : {}),
				errors: blockingErrors,
			});
			console.warn(
				`[bloqueado] registro ${index}${itineraryId ? ` (${itineraryId})` : ""}: ${blockingErrors.join("; ")}`,
			);
			continue;
		}

		try {
			const owner = await resolveOwner(mapped.publicatorEmail);
			const result = await deps.importLegacyCollection(
				db,
				{ itinerary: mapped, ownerId: owner.userId },
				{ dryRun: options.dryRun },
			);
			const counter = {
				created: "created",
				updated: "updated",
				unchanged: "unchanged",
				would_create: "wouldCreate",
				would_update: "wouldUpdate",
			} as const;
			totals[counter[result.outcome]]++;
			if (result.owner === "system") totals.withoutOwner++;
			totals.missingResources += result.missingResources.length;
			for (const field of mapped.discardedFields) {
				totals.discardedMetadata[field]++;
			}
			records.push({
				outcome: result.outcome,
				itineraryId: mapped.externalId,
				collectionId: result.collectionId,
				owner: result.owner,
				// El motivo solo explica por qué sigue a nombre del sistema.
				...(result.owner === "system" && owner.reason
					? { ownerReason: owner.reason }
					: {}),
				linkedResources: result.linkedResources,
				missingResources: result.missingResources,
				discardedFields: mapped.discardedFields,
				warnings: mapped.warnings,
			});
			for (const missing of result.missingResources) {
				console.warn(
					`[recurso ${missing.reason === "deleted" ? "dado de baja" : "no encontrado"}] itinerario ${mapped.externalId}: ${missing.externalId} (${KIND_LABEL[missing.kind]})`,
				);
			}
			if (result.owner === "system") {
				console.warn(
					`[sin propietario] itinerario ${mapped.externalId}: ${owner.reason ?? "sin cuenta"}; queda en borrador a nombre del sistema`,
				);
			}
		} catch (error) {
			// Solo hay pasos de base de datos: nunca se copia su mensaje (#488).
			const summary = summarizeDbStepError(error);
			totals.errored++;
			records.push({
				outcome: "error",
				index,
				itineraryId: mapped.externalId,
				...summary,
			});
			console.error(
				`[error] registro ${index} (${mapped.externalId}): ${formatImportError(summary)}`,
			);
		}
	}

	return {
		runId: crypto.randomUUID(),
		sourceFile: options.sourceFile,
		dryRun: options.dryRun,
		startedAt,
		finishedAt: new Date().toISOString(),
		totals,
		records,
	};
}
