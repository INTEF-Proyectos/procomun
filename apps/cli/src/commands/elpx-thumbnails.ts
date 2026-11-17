/**
 * CLI: relleno de miniaturas generadas en el servidor (#470, ADR-0046).
 *
 * Marca como pendientes los proyectos .elpx cuya tarjeta no tiene imagen: sin
 * screenshot.png y en un recurso sin la imagen `preview` legacy. Las capturas
 * las hace el bucle de la API (THUMBNAILER_URL), no este comando. Se puede
 * repetir: los que ya están en cola o hechos no se tocan, así que con
 * `--limit` cada pasada sigue donde lo dejó la anterior.
 *
 * Uso: bun run apps/cli/src/index.ts elpx:thumbnails [--dry-run] [--limit <n>] [--force]
 */

export interface ElpxThumbnailOptions {
	dryRun: boolean;
	limit: number | null;
	/** Vuelve a encolar también los `failed` y `empty`. */
	force: boolean;
}

export interface ElpxThumbnailDeps {
	listCandidates: () => Promise<Array<{ id: string; status: string | null }>>;
	enqueue: (ids: string[]) => Promise<number>;
	countStatuses: () => Promise<Record<string, number>>;
}

export interface ElpxThumbnailReport {
	dryRun: boolean;
	/** Proyectos cuya tarjeta no tiene imagen. */
	candidates: number;
	/** Ya `pending` o `processing`. */
	inQueue: number;
	done: number;
	/** `failed` o `empty` sin `--force`. */
	notRetried: number;
	selected: number;
	queued: number;
	totals: Record<string, number>;
}

const QUEUED = new Set(["pending", "processing"]);
const RETRYABLE = new Set(["failed", "empty"]);

export function parseElpxThumbnailArgs(args: string[]): ElpxThumbnailOptions {
	const options: ElpxThumbnailOptions = {
		dryRun: false,
		limit: null,
		force: false,
	};
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		if (arg === "--dry-run") options.dryRun = true;
		else if (arg === "--force") options.force = true;
		else if (arg === "--limit") {
			const value = Number(args[++i]);
			if (!Number.isInteger(value) || value <= 0) {
				throw new Error("--limit necesita un entero positivo");
			}
			options.limit = value;
		} else throw new Error(`Argumento desconocido: ${arg}`);
	}
	return options;
}

export async function runElpxThumbnailBackfill(
	options: ElpxThumbnailOptions,
	deps: ElpxThumbnailDeps,
): Promise<ElpxThumbnailReport> {
	const candidates = await deps.listCandidates();
	const selected: string[] = [];
	let inQueue = 0;
	let done = 0;
	let notRetried = 0;
	for (const candidate of candidates) {
		const status = candidate.status;
		if (status && QUEUED.has(status)) inQueue++;
		else if (status === "done") done++;
		else if (status && RETRYABLE.has(status) && !options.force) notRetried++;
		else selected.push(candidate.id);
	}
	const batch =
		options.limit === null ? selected : selected.slice(0, options.limit);
	const queued = options.dryRun ? 0 : await deps.enqueue(batch);
	return {
		dryRun: options.dryRun,
		candidates: candidates.length,
		inQueue,
		done,
		notRetried,
		selected: batch.length,
		queued,
		totals: await deps.countStatuses(),
	};
}

export function formatElpxThumbnailReport(
	report: ElpxThumbnailReport,
): string[] {
	const totals = Object.entries(report.totals)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([status, total]) => `${status}=${total}`)
		.join(" ");
	return [
		`[elpx:thumbnails]${report.dryRun ? " (dry-run)" : ""} sin_imagen=${report.candidates} en_cola=${report.inQueue} hechos=${report.done} sin_reintentar=${report.notRetried} seleccionados=${report.selected} encolados=${report.queued}`,
		`[elpx:thumbnails] estados: ${totals || "sin proyectos"}`,
	];
}

export async function elpxThumbnails(args: string[]) {
	const options = parseElpxThumbnailArgs(args);
	const [{ getDb, waitForDb }, repo] = await Promise.all([
		import("../../../api/src/db.ts"),
		import("@procomun/db/repository"),
	]);
	await waitForDb();
	const db = getDb().db;

	const report = await runElpxThumbnailBackfill(options, {
		listCandidates: () => repo.listThumbnailBackfillCandidates(db),
		enqueue: (ids) => repo.enqueueThumbnailJobs(db, ids),
		countStatuses: () => repo.countThumbnailStatuses(db),
	});
	for (const line of formatElpxThumbnailReport(report)) console.log(line);
}
