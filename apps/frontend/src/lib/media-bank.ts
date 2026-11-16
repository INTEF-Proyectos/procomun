/**
 * Enlace al banco multimedia externo (#569). La URL la da la API en
 * `/api/v1/config` (`MEDIA_BANK_URL`); si falta, no se muestra el enlace.
 */

/** Devuelve la URL solo si es http(s) absoluta; si no, `null`. */
export function safeMediaBankUrl(
	value: string | null | undefined,
): string | null {
	if (!value) return null;
	try {
		const { protocol } = new URL(value);
		return protocol === "http:" || protocol === "https:" ? value : null;
	} catch {
		return null;
	}
}

type ConfigLoader = () => Promise<{ mediaBankUrl?: string | null }>;

let cached: Promise<string | null> | null = null;

/** Pide la configuración una sola vez y la comparte la cabecera y `/nuevo`. */
export function loadMediaBankUrl(
	getConfig: ConfigLoader,
): Promise<string | null> {
	if (!cached) {
		cached = getConfig()
			.then((config) => safeMediaBankUrl(config?.mediaBankUrl))
			.catch(() => null);
	}
	return cached;
}

/** Solo para tests. */
export function resetMediaBankUrlCache(): void {
	cached = null;
}
