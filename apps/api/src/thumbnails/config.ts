/**
 * Configuración del bucle de miniaturas (#470, ADR-0046). El bucle solo se
 * activa con `THUMBNAILER_URL`: sin ella todo sigue como antes y la tarjeta
 * muestra el marcador del tipo de recurso. Nunca corre con NODE_ENV=test.
 */

type Env = Record<string, string | undefined>;

export type ThumbnailerConfig = {
	enabled: boolean;
	/** Motivo por el que no se activa, para el log de arranque. */
	disabledReason: string | null;
	url: string | null;
	/** Capturas a la vez; conviene que coincida con la del servicio. */
	concurrency: number;
	/** Espera entre consultas a la cola cuando no hay trabajo. */
	pollIntervalMs: number;
	/** Tiempo máximo de una petición al servicio (incluye su cola). */
	requestTimeoutMs: number;
	maxAttempts: number;
	/** Primer reintento; cada uno siguiente espera cuatro veces más. */
	retryBaseMs: number;
	/** Un `processing` más antiguo que esto se da por interrumpido. */
	staleAfterMs: number;
	/** Pausa del bucle cuando el servicio no responde. */
	unavailablePauseMs: number;
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

function parseServiceUrl(value: string | undefined): string | null {
	const raw = value?.trim();
	if (!raw) return null;
	try {
		const url = new URL(raw);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		return url.href.replace(/\/+$/, "");
	} catch {
		return null;
	}
}

export function getThumbnailerConfig(
	env: Env = process.env,
): ThumbnailerConfig {
	const url = parseServiceUrl(env.THUMBNAILER_URL);
	let disabledReason: string | null = null;
	if (env.NODE_ENV === "test") disabledReason = "NODE_ENV=test";
	else if (env.THUMBNAILER_DISABLED === "true") {
		disabledReason = "THUMBNAILER_DISABLED=true";
	} else if (!env.THUMBNAILER_URL?.trim()) {
		disabledReason = "sin THUMBNAILER_URL";
	} else if (!url) disabledReason = "THUMBNAILER_URL no es una URL http(s)";

	return {
		enabled: disabledReason === null,
		disabledReason,
		url,
		concurrency: positiveInt(env.THUMBNAILER_CONCURRENCY, 2, 16),
		pollIntervalMs: positiveInt(env.THUMBNAILER_POLL_INTERVAL_MS, 15_000),
		requestTimeoutMs: positiveInt(env.THUMBNAILER_REQUEST_TIMEOUT_MS, 60_000),
		maxAttempts: positiveInt(env.THUMBNAILER_MAX_ATTEMPTS, 3, 10),
		retryBaseMs: positiveInt(env.THUMBNAILER_RETRY_BASE_MS, 60_000),
		staleAfterMs: positiveInt(env.THUMBNAILER_STALE_AFTER_MS, 10 * 60_000),
		unavailablePauseMs: positiveInt(
			env.THUMBNAILER_UNAVAILABLE_PAUSE_MS,
			60_000,
		),
	};
}
