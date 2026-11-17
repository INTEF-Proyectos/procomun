/**
 * Arranque del bucle de miniaturas en el proceso de la API (#470). Une el
 * bucle con la base de datos, el almacén de miniaturas y el servicio
 * `thumbnailer`. Sin `THUMBNAILER_URL` no hace nada.
 */

import type { DrizzleDB } from "@procomun/db/repository";
import * as repo from "@procomun/db/repository";
import { getDb, waitForDb } from "../db.ts";
import { storeThumbnailBytes } from "../services/legacy-preview-image.ts";
import { getUploadConfig } from "../uploads/config.ts";
import { getThumbnailerConfig, type ThumbnailerConfig } from "./config.ts";
import { createHttpThumbnailRenderer } from "./renderer.ts";
import {
	createThumbnailWorker,
	type ThumbnailQueue,
	type ThumbnailWorker,
	type ThumbnailWorkerDeps,
} from "./worker.ts";

type Env = Record<string, string | undefined>;
type Logger = Pick<typeof console, "info" | "warn" | "error">;

export function createDbThumbnailQueue(db: DrizzleDB): ThumbnailQueue {
	return {
		claim: (limit, now) => repo.claimThumbnailJobs(db, { limit, now }),
		recoverStale: (staleBefore, maxAttempts, now) =>
			repo.recoverStaleThumbnailJobs(db, { staleBefore, maxAttempts, now }),
		complete: (id, file, now) =>
			repo.completeThumbnailJob(db, id, { file, now }),
		markEmpty: (id, now) => repo.markThumbnailEmpty(db, id, { now }),
		fail: (job, options) => repo.failThumbnailJob(db, job, options),
		release: (id, options) => repo.releaseThumbnailJob(db, id, options),
	};
}

export function buildThumbnailWorkerDeps(
	config: ThumbnailerConfig & { url: string },
	options: { db: DrizzleDB; storageDir: string; log?: Logger },
): ThumbnailWorkerDeps {
	return {
		queue: createDbThumbnailQueue(options.db),
		renderer: createHttpThumbnailRenderer({
			baseUrl: config.url,
			timeoutMs: config.requestTimeoutMs,
		}),
		store: (bytes) => storeThumbnailBytes(options.storageDir, bytes),
		config,
		log: options.log,
	};
}

// Con `bun --hot` el módulo se vuelve a evaluar: el bucle va en globalThis
// para no arrancar uno nuevo en cada recarga.
const WORKER_KEY = Symbol.for("procomun.thumbnailWorker");
type GlobalWithWorker = typeof globalThis & {
	[WORKER_KEY]?: ThumbnailWorker;
};

export function startThumbnailWorkerFromEnv(
	env: Env = process.env,
	options: {
		log?: Logger;
		create?: (deps: ThumbnailWorkerDeps) => ThumbnailWorker;
	} = {},
): ThumbnailWorker | null {
	const log = options.log ?? console;
	const config = getThumbnailerConfig(env);
	if (!config.enabled || !config.url) {
		if (config.disabledReason !== "NODE_ENV=test") {
			log.info(`[thumbnails] bucle desactivado (${config.disabledReason})`);
		}
		return null;
	}
	const holder = globalThis as GlobalWithWorker;
	const existing = holder[WORKER_KEY];
	if (existing) return existing;

	const deps = buildThumbnailWorkerDeps(
		{ ...config, url: config.url },
		{ db: getDb().db, storageDir: getUploadConfig(env).storageDir, log },
	);
	const worker = (options.create ?? createThumbnailWorker)(deps);
	holder[WORKER_KEY] = worker;
	waitForDb()
		.then(() => {
			worker.start();
			log.info(
				`[thumbnails] bucle activo contra ${config.url} (concurrencia ${config.concurrency})`,
			);
		})
		.catch((err) => {
			log.error(`[thumbnails] no se pudo arrancar el bucle: ${String(err)}`);
		});
	return worker;
}

/** Para los tests: olvida el bucle registrado. */
export function resetThumbnailWorkerForTests(): void {
	delete (globalThis as GlobalWithWorker)[WORKER_KEY];
}
