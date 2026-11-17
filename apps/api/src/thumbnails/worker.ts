/**
 * Bucle de miniaturas en la API (#470, ADR-0046, opción B1).
 *
 * Toma de `elpx_projects` los proyectos pendientes, pide la captura al
 * servicio `thumbnailer`, guarda la imagen en `storageDir/thumbnails/` y anota
 * el resultado. Sin broker: el estado vive en la base de datos y sobrevive a
 * reinicios. Si el servicio no responde, las subidas siguen y los trabajos
 * esperan (RNF-3).
 */
import type { ThumbnailJob, ThumbnailStatus } from "@procomun/db/repository";
import { sanitizeForLog } from "../fts/worker.ts";
import type { ThumbnailerConfig } from "./config.ts";
import type { RenderOutcome, ThumbnailRenderer } from "./renderer.ts";

export interface ThumbnailQueue {
	claim(limit: number, now: Date): Promise<ThumbnailJob[]>;
	recoverStale(
		staleBefore: Date,
		maxAttempts: number,
		now: Date,
	): Promise<{ requeued: number; failed: number }>;
	complete(id: string, file: string, now: Date): Promise<unknown>;
	markEmpty(id: string, now: Date): Promise<unknown>;
	fail(
		job: ThumbnailJob,
		options: {
			error: string;
			retryable: boolean;
			maxAttempts: number;
			retryAt: Date;
			now: Date;
		},
	): Promise<ThumbnailStatus>;
	release(
		id: string,
		options: { retryAt: Date; error: string; now: Date },
	): Promise<unknown>;
}

type Logger = Pick<typeof console, "info" | "warn" | "error">;

export type ThumbnailWorkerDeps = {
	queue: ThumbnailQueue;
	renderer: ThumbnailRenderer;
	/** Guarda la imagen; `null` si los bytes no son una imagen admitida. */
	store: (bytes: Uint8Array) => Promise<{ file: string } | null>;
	config: Pick<
		ThumbnailerConfig,
		| "concurrency"
		| "pollIntervalMs"
		| "maxAttempts"
		| "retryBaseMs"
		| "staleAfterMs"
		| "unavailablePauseMs"
	>;
	now?: () => Date;
	log?: Logger;
	sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export type ThumbnailJobResult = ThumbnailStatus | "released";

const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1000;

/** Espera antes del intento `attempt` (1, 2, 3…): base, 4×base, 16×base… */
export function retryDelayMs(attempt: number, baseMs: number): number {
	const exponent = Math.max(0, attempt - 1);
	return Math.min(baseMs * 4 ** exponent, MAX_RETRY_DELAY_MS);
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export async function processThumbnailJob(
	job: ThumbnailJob,
	deps: ThumbnailWorkerDeps,
): Promise<ThumbnailJobResult> {
	const now = (deps.now ?? (() => new Date()))();
	const log = deps.log ?? console;
	const { config, queue } = deps;

	let outcome: RenderOutcome;
	try {
		outcome = await deps.renderer.render(job.hash);
	} catch (err) {
		outcome = { kind: "failed", reason: errorMessage(err), retryable: true };
	}

	if (outcome.kind === "image") {
		try {
			const stored = await deps.store(outcome.bytes);
			if (stored) {
				await queue.complete(job.id, stored.file, now);
				return "done";
			}
			outcome = {
				kind: "failed",
				reason: "la respuesta del servicio no es una imagen",
				retryable: false,
			};
		} catch (err) {
			outcome = {
				kind: "failed",
				reason: `no se pudo guardar la miniatura (${errorMessage(err)})`,
				retryable: true,
			};
		}
	}

	if (outcome.kind === "empty") {
		await queue.markEmpty(job.id, now);
		return "empty";
	}

	if (outcome.kind === "unavailable") {
		await queue.release(job.id, {
			retryAt: new Date(now.getTime() + config.unavailablePauseMs),
			error: sanitizeForLog(outcome.reason),
			now,
		});
		return "released";
	}

	const reason = sanitizeForLog(outcome.reason);
	const status = await queue.fail(job, {
		error: reason,
		retryable: outcome.retryable,
		maxAttempts: config.maxAttempts,
		retryAt: new Date(
			now.getTime() + retryDelayMs(job.attempts + 1, config.retryBaseMs),
		),
		now,
	});
	log.warn(
		`[thumbnails] captura fallida hash=${sanitizeForLog(job.hash)} estado=${status}: ${reason}`,
	);
	return status;
}

export type ThumbnailTickResult = {
	claimed: number;
	results: ThumbnailJobResult[];
	/** El servicio no respondía: el bucle se toma una pausa. */
	unavailable: boolean;
};

/** Una vuelta: recupera los colgados, reclama un lote y lo procesa. */
export async function runThumbnailTick(
	deps: ThumbnailWorkerDeps,
): Promise<ThumbnailTickResult> {
	const now = (deps.now ?? (() => new Date()))();
	const { config, queue } = deps;
	const recovered = await queue.recoverStale(
		new Date(now.getTime() - config.staleAfterMs),
		config.maxAttempts,
		now,
	);
	if (recovered.requeued || recovered.failed) {
		(deps.log ?? console).warn(
			`[thumbnails] capturas interrumpidas: ${recovered.requeued} a la cola, ${recovered.failed} fallidas`,
		);
	}
	const jobs = await queue.claim(config.concurrency, now);
	const results = await Promise.all(
		jobs.map((job) => processThumbnailJob(job, deps)),
	);
	return {
		claimed: jobs.length,
		results,
		unavailable: results.includes("released"),
	};
}

/** Pausa hasta la siguiente vuelta según lo que pasó en la anterior. */
export function nextDelayMs(
	result: ThumbnailTickResult | null,
	config: ThumbnailWorkerDeps["config"],
): number {
	if (!result) return config.pollIntervalMs;
	if (result.unavailable) return config.unavailablePauseMs;
	// Lote completo: seguramente quedan más pendientes.
	if (result.claimed >= config.concurrency) return 0;
	return config.pollIntervalMs;
}

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve();
		const timer = setTimeout(done, ms);
		function done() {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		}
		signal.addEventListener("abort", done, { once: true });
	});
}

export type ThumbnailWorker = {
	start(): void;
	stop(): Promise<void>;
	readonly running: boolean;
};

export function createThumbnailWorker(
	deps: ThumbnailWorkerDeps,
): ThumbnailWorker {
	const sleep = deps.sleep ?? defaultSleep;
	const log = deps.log ?? console;
	let controller: AbortController | null = null;
	let loop: Promise<void> | null = null;

	async function run(signal: AbortSignal) {
		while (!signal.aborted) {
			let result: ThumbnailTickResult | null = null;
			try {
				result = await runThumbnailTick(deps);
			} catch (err) {
				log.error(
					`[thumbnails] error en el bucle: ${sanitizeForLog(errorMessage(err))}`,
				);
			}
			const delay = nextDelayMs(result, deps.config);
			if (delay > 0) await sleep(delay, signal);
		}
	}

	return {
		start() {
			if (loop) return;
			controller = new AbortController();
			loop = run(controller.signal);
		},
		async stop() {
			controller?.abort();
			await loop;
			loop = null;
			controller = null;
		},
		get running() {
			return loop !== null;
		},
	};
}
