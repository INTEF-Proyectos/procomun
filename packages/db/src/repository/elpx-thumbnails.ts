/**
 * Cola de miniaturas generadas en el servidor (#470, ADR-0046).
 *
 * El estado vive en `elpx_projects` y no en `resources`, igual que
 * `has_screenshot`: las versiones apuntan al proyecto, así que restaurar una
 * versión conserva su miniatura. No hay broker: el bucle de la API reclama
 * lotes con `FOR UPDATE SKIP LOCKED`, de modo que dos procesos no capturan el
 * mismo paquete.
 */
import {
	and,
	asc,
	count,
	desc,
	eq,
	inArray,
	isNull,
	lte,
	or,
	sql,
} from "drizzle-orm";
import { elpxProjects } from "../schema/elpx.ts";
import { resources } from "../schema/resources.ts";
import { resourceVersions } from "../schema/versions.ts";
import type { DrizzleDB } from "./shared.ts";

export const THUMBNAIL_STATUSES = [
	"pending",
	"processing",
	"done",
	"empty",
	"failed",
	"skipped",
] as const;
export type ThumbnailStatus = (typeof THUMBNAIL_STATUSES)[number];

/** El motivo se guarda recortado: es para diagnosticar, no un log completo. */
export const MAX_THUMBNAIL_ERROR_LENGTH = 500;

export type ThumbnailJob = { id: string; hash: string; attempts: number };

function clipError(error: string): string {
	return error.length > MAX_THUMBNAIL_ERROR_LENGTH
		? `${error.slice(0, MAX_THUMBNAIL_ERROR_LENGTH - 1)}…`
		: error;
}

/**
 * Estado con el que nace un proyecto. Solo se captura si hay portada
 * (`index.html`), eXe no trajo `screenshot.png` y el recurso no tiene ya la
 * imagen `preview` del Procomún antiguo: en esos casos la tarjeta nunca
 * mostraría la miniatura generada.
 */
export function initialThumbnailStatus(project: {
	hasPreview?: boolean;
	hasScreenshot?: boolean;
	hasPreviewImage?: boolean;
}): ThumbnailStatus {
	return project.hasPreview &&
		!project.hasScreenshot &&
		!project.hasPreviewImage
		? "pending"
		: "skipped";
}

/** `db.execute` devuelve `{ rows }` con PGlite y un array con bun-sql. */
function rowsOf<T>(raw: unknown): T[] {
	if (Array.isArray(raw)) return raw as T[];
	if (raw && typeof raw === "object" && "rows" in raw) {
		const rows = (raw as { rows: unknown }).rows;
		if (Array.isArray(rows)) return rows as T[];
	}
	return [];
}

/**
 * Reclama hasta `limit` trabajos pendientes y los pasa a `processing`. Los que
 * esperan su reintento (`thumbnail_next_attempt_at` en el futuro) no salen.
 *
 * La selección va en un CTE materializado y no en `id IN (SELECT … LIMIT …
 * FOR UPDATE SKIP LOCKED)`: PostgreSQL puede evaluar esa subconsulta más de
 * una vez y reclamar más filas que `limit`.
 */
export async function claimThumbnailJobs(
	db: DrizzleDB,
	options: { limit: number; now?: Date },
): Promise<ThumbnailJob[]> {
	if (options.limit <= 0) return [];
	const now = (options.now ?? new Date()).toISOString();
	const raw: unknown = await db.execute(sql`
		WITH due AS MATERIALIZED (
			SELECT id FROM elpx_projects
			WHERE thumbnail_status = 'pending'
				AND (thumbnail_next_attempt_at IS NULL
					OR thumbnail_next_attempt_at <= ${now}::timestamptz)
			ORDER BY thumbnail_next_attempt_at ASC NULLS FIRST, created_at ASC, id ASC
			LIMIT ${Math.floor(options.limit)}
			FOR UPDATE SKIP LOCKED
		)
		UPDATE elpx_projects AS p
		SET thumbnail_status = 'processing', thumbnail_updated_at = ${now}::timestamptz
		FROM due
		WHERE p.id = due.id
		RETURNING p.id, p.hash, p.thumbnail_attempts AS attempts
	`);
	return rowsOf<{ id: string; hash: string; attempts: number | string }>(
		raw,
	).map((row) => ({
		id: row.id,
		hash: row.hash,
		attempts: Number(row.attempts),
	}));
}

/**
 * Devuelve a la cola los `processing` que llevan colgados desde antes de
 * `staleBefore` (la API se reinició a mitad de una captura). Cuenta como
 * intento: un paquete que tumba el servicio no puede reintentarse sin fin.
 */
export async function recoverStaleThumbnailJobs(
	db: DrizzleDB,
	options: { staleBefore: Date; maxAttempts: number; now?: Date },
): Promise<{ requeued: number; failed: number }> {
	const now = options.now ?? new Date();
	const stale = and(
		eq(elpxProjects.thumbnailStatus, "processing"),
		lte(elpxProjects.thumbnailUpdatedAt, options.staleBefore),
	);
	const error = "la captura no terminó (proceso interrumpido)";
	const failed = await db
		.update(elpxProjects)
		.set({
			thumbnailStatus: "failed",
			thumbnailAttempts: sql`${elpxProjects.thumbnailAttempts} + 1`,
			thumbnailError: error,
			thumbnailUpdatedAt: now,
			thumbnailNextAttemptAt: null,
		})
		.where(
			and(
				stale,
				sql`${elpxProjects.thumbnailAttempts} + 1 >= ${options.maxAttempts}`,
			),
		)
		.returning({ id: elpxProjects.id });
	const requeued = await db
		.update(elpxProjects)
		.set({
			thumbnailStatus: "pending",
			thumbnailAttempts: sql`${elpxProjects.thumbnailAttempts} + 1`,
			thumbnailError: error,
			thumbnailUpdatedAt: now,
			thumbnailNextAttemptAt: now,
		})
		.where(stale)
		.returning({ id: elpxProjects.id });
	return { requeued: requeued.length, failed: failed.length };
}

const isProcessing = (id: string) =>
	and(eq(elpxProjects.id, id), eq(elpxProjects.thumbnailStatus, "processing"));

/** Captura guardada: `file` es el nombre en `storageDir/thumbnails/`. */
export async function completeThumbnailJob(
	db: DrizzleDB,
	id: string,
	options: { file: string; now?: Date },
): Promise<boolean> {
	const rows = await db
		.update(elpxProjects)
		.set({
			thumbnailStatus: "done",
			thumbnailFile: options.file,
			thumbnailAttempts: sql`${elpxProjects.thumbnailAttempts} + 1`,
			thumbnailError: null,
			thumbnailUpdatedAt: options.now ?? new Date(),
			thumbnailNextAttemptAt: null,
		})
		.where(isProcessing(id))
		.returning({ id: elpxProjects.id });
	return rows.length > 0;
}

/** Portada sin texto ni imágenes visibles: no se guarda nada. */
export async function markThumbnailEmpty(
	db: DrizzleDB,
	id: string,
	options: { now?: Date } = {},
): Promise<boolean> {
	const rows = await db
		.update(elpxProjects)
		.set({
			thumbnailStatus: "empty",
			thumbnailFile: null,
			thumbnailAttempts: sql`${elpxProjects.thumbnailAttempts} + 1`,
			thumbnailError: null,
			thumbnailUpdatedAt: options.now ?? new Date(),
			thumbnailNextAttemptAt: null,
		})
		.where(isProcessing(id))
		.returning({ id: elpxProjects.id });
	return rows.length > 0;
}

/**
 * Fallo de una captura. Si es pasajero y quedan intentos vuelve a `pending`
 * con su hora de reintento; si no, queda en `failed`.
 */
export async function failThumbnailJob(
	db: DrizzleDB,
	job: Pick<ThumbnailJob, "id" | "attempts">,
	options: {
		error: string;
		retryable: boolean;
		maxAttempts: number;
		retryAt: Date;
		now?: Date;
	},
): Promise<ThumbnailStatus> {
	const attempts = job.attempts + 1;
	const status: ThumbnailStatus =
		options.retryable && attempts < options.maxAttempts ? "pending" : "failed";
	await db
		.update(elpxProjects)
		.set({
			thumbnailStatus: status,
			thumbnailAttempts: attempts,
			thumbnailError: clipError(options.error),
			thumbnailUpdatedAt: options.now ?? new Date(),
			thumbnailNextAttemptAt: status === "pending" ? options.retryAt : null,
		})
		.where(isProcessing(job.id));
	return status;
}

/**
 * Devuelve el trabajo a la cola sin gastar un intento: el servicio de captura
 * no respondía, el paquete no tiene la culpa.
 */
export async function releaseThumbnailJob(
	db: DrizzleDB,
	id: string,
	options: { retryAt: Date; error?: string; now?: Date },
): Promise<void> {
	await db
		.update(elpxProjects)
		.set({
			thumbnailStatus: "pending",
			thumbnailError: options.error ? clipError(options.error) : null,
			thumbnailUpdatedAt: options.now ?? new Date(),
			thumbnailNextAttemptAt: options.retryAt,
		})
		.where(isProcessing(id));
}

export type ThumbnailBackfillCandidate = {
	id: string;
	hash: string;
	status: string | null;
	createdAt: Date;
};

/**
 * Proyectos que necesitan miniatura generada (#470): el que enseña la tarjeta
 * de cada recurso (el de la versión vigente o, sin versiones, el más
 * reciente, como `listElpxProjectsByResourceIds`), con portada, sin
 * `screenshot.png` y en un recurso sin la imagen `preview` legacy.
 */
export async function listThumbnailBackfillCandidates(
	db: DrizzleDB,
): Promise<ThumbnailBackfillCandidate[]> {
	const listing = db
		.selectDistinctOn([elpxProjects.resourceId], {
			id: elpxProjects.id,
			hash: elpxProjects.hash,
			hasPreview: elpxProjects.hasPreview,
			hasScreenshot: elpxProjects.hasScreenshot,
			status: elpxProjects.thumbnailStatus,
			createdAt: elpxProjects.createdAt,
			resourceThumbnailUrl: resources.thumbnailUrl,
			resourceDeletedAt: resources.deletedAt,
		})
		.from(elpxProjects)
		.innerJoin(resources, eq(elpxProjects.resourceId, resources.id))
		.leftJoin(
			resourceVersions,
			eq(resources.currentVersionId, resourceVersions.id),
		)
		.orderBy(
			elpxProjects.resourceId,
			sql`COALESCE(${resourceVersions.elpxProjectId} = ${elpxProjects.id}, false) DESC`,
			desc(elpxProjects.createdAt),
		)
		.as("listing");
	return db
		.select({
			id: listing.id,
			hash: listing.hash,
			status: listing.status,
			createdAt: listing.createdAt,
		})
		.from(listing)
		.where(
			and(
				eq(listing.hasPreview, true),
				eq(listing.hasScreenshot, false),
				isNull(listing.resourceDeletedAt),
				or(
					isNull(listing.resourceThumbnailUrl),
					sql`btrim(${listing.resourceThumbnailUrl}) = ''`,
				),
			),
		)
		.orderBy(asc(listing.createdAt), asc(listing.id));
}

/** Marca como pendientes los proyectos indicados y reinicia sus intentos. */
export async function enqueueThumbnailJobs(
	db: DrizzleDB,
	ids: string[],
	options: { now?: Date } = {},
): Promise<number> {
	if (!ids.length) return 0;
	const now = options.now ?? new Date();
	let total = 0;
	for (let i = 0; i < ids.length; i += 500) {
		const rows = await db
			.update(elpxProjects)
			.set({
				thumbnailStatus: "pending",
				thumbnailAttempts: 0,
				thumbnailError: null,
				thumbnailUpdatedAt: now,
				thumbnailNextAttemptAt: null,
			})
			.where(
				and(
					inArray(elpxProjects.id, ids.slice(i, i + 500)),
					or(
						isNull(elpxProjects.thumbnailStatus),
						sql`${elpxProjects.thumbnailStatus} NOT IN ('pending', 'processing')`,
					),
				),
			)
			.returning({ id: elpxProjects.id });
		total += rows.length;
	}
	return total;
}

/** Totales por estado de todos los proyectos; `null` cuenta como `sin_estado`. */
export async function countThumbnailStatuses(
	db: DrizzleDB,
): Promise<Record<string, number>> {
	const rows = await db
		.select({ status: elpxProjects.thumbnailStatus, total: count() })
		.from(elpxProjects)
		.groupBy(elpxProjects.thumbnailStatus);
	const totals: Record<string, number> = {};
	for (const row of rows) {
		totals[row.status ?? "sin_estado"] = Number(row.total);
	}
	return totals;
}

/**
 * `public`: el fichero pertenece al menos a un recurso publicado y no
 * borrado. `private`: solo a recursos no publicados, o a un proyecto que no
 * es el vigente. `null`: a ningún recurso no borrado.
 */
export type ThumbnailFileVisibility = "public" | "private";

/**
 * Quién puede ver un fichero de `storageDir/thumbnails/` (revisión de #481,
 * adenda 2026-11-03 de ADR-0046). El nombre es el sha256 del contenido, así
 * que varios recursos pueden compartirlo: basta con que uno publicado lo use.
 *
 * Un fichero pertenece a un recurso por su `thumbnail_url` (preview legacy,
 * #472) o por la miniatura generada de un proyecto (#470). Del proyecto solo
 * cuenta el vigente si el recurso tiene versión vigente, como en
 * `isElpxHashHistorical` (#323): la copia de trabajo nueva de un recurso
 * publicado no sale hasta que se publica.
 */
export async function getThumbnailFileVisibility(
	db: DrizzleDB,
	file: string,
	legacyUrl: string,
): Promise<ThumbnailFileVisibility | null> {
	const legacy = await db
		.select({ status: resources.editorialStatus })
		.from(resources)
		.where(
			and(eq(resources.thumbnailUrl, legacyUrl), isNull(resources.deletedAt)),
		);
	const generated = await db
		.select({
			status: resources.editorialStatus,
			isCurrent: sql<boolean>`(${resourceVersions.elpxProjectId} IS NULL OR ${resourceVersions.elpxProjectId} = ${elpxProjects.id})`,
		})
		.from(elpxProjects)
		.innerJoin(resources, eq(elpxProjects.resourceId, resources.id))
		.leftJoin(
			resourceVersions,
			eq(resources.currentVersionId, resourceVersions.id),
		)
		.where(
			and(eq(elpxProjects.thumbnailFile, file), isNull(resources.deletedAt)),
		);

	if (legacy.length === 0 && generated.length === 0) return null;
	const isPublic =
		legacy.some((row) => row.status === "published") ||
		generated.some((row) => row.status === "published" && row.isCurrent);
	return isPublic ? "public" : "private";
}
