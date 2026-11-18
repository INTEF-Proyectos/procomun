/**
 * Configuración del servicio `thumbnailer` (#470, ADR-0046). Todo por
 * variables de entorno y ninguna es un secreto: el servicio no tiene
 * credenciales ni base de datos.
 */
import path from "node:path";

type Env = Record<string, string | undefined>;

export type ThumbnailerServiceConfig = {
	host: string;
	port: number;
	/** Raíz del almacenamiento; los paquetes están en `<raíz>/elpx/<hash>/`. */
	storageDir: string;
	/** Capturas a la vez. */
	concurrency: number;
	/** Peticiones en espera; con más, el servicio responde 503 (ocupado). */
	queueLimit: number;
	/** Tiempo máximo de una captura, de principio a fin. */
	timeoutMs: number;
	/** Margen tras `load` y las fuentes para que eXe termine de pintar. */
	settleMs: number;
	/** El navegador se reinicia cada N capturas. */
	recycleAfter: number;
	/** Tamaño al que se intenta ajustar el JPEG bajando la calidad. */
	maxImageBytes: number;
	/** Ficheros del paquete más grandes que esto no se sirven al navegador. */
	maxAssetBytes: number;
	/** Sandbox de Chromium. Desactivarlo deja solo el aislamiento del contenedor. */
	chromiumSandbox: boolean;
	/** Ejecutable de Chromium; vacío usa el que instala Playwright. */
	chromiumPath: string | null;
};

function positiveInt(
	value: string | undefined,
	fallback: number,
	max = Number.MAX_SAFE_INTEGER,
): number {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0
		? Math.min(parsed, max)
		: fallback;
}

export function getThumbnailerServiceConfig(
	env: Env = process.env,
): ThumbnailerServiceConfig {
	return {
		host: env.THUMBNAILER_HOST?.trim() || "0.0.0.0",
		port: positiveInt(env.THUMBNAILER_PORT, 3100, 65535),
		storageDir:
			env.THUMBNAILER_STORAGE_DIR?.trim() ||
			env.UPLOAD_STORAGE_DIR?.trim() ||
			path.join(import.meta.dir, "../../../local-data/uploads"),
		concurrency: positiveInt(env.THUMBNAILER_CONCURRENCY, 2, 16),
		queueLimit: positiveInt(env.THUMBNAILER_QUEUE_LIMIT, 8, 1000),
		timeoutMs: positiveInt(env.THUMBNAILER_TIMEOUT_MS, 15_000),
		settleMs: positiveInt(env.THUMBNAILER_SETTLE_MS, 500, 10_000),
		recycleAfter: positiveInt(env.THUMBNAILER_RECYCLE_AFTER, 50),
		maxImageBytes: positiveInt(env.THUMBNAILER_MAX_IMAGE_BYTES, 100 * 1024),
		maxAssetBytes: positiveInt(
			env.THUMBNAILER_MAX_ASSET_BYTES,
			20 * 1024 * 1024,
		),
		chromiumSandbox: env.THUMBNAILER_CHROMIUM_SANDBOX !== "false",
		chromiumPath: env.THUMBNAILER_CHROMIUM_PATH?.trim() || null,
	};
}
