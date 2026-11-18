/**
 * Enlace al banco multimedia externo (#569). La URL la da la API en
 * `/api/v1/config` (`MEDIA_BANK_URL`); si falta, no se muestra el enlace.
 */

/**
 * Devuelve la URL normalizada solo si empieza por `http://` o `https://`; si
 * no, `null`. `new URL` acepta `https:banco.example.org` sin doble barra.
 */
export function safeMediaBankUrl(
	value: string | null | undefined,
): string | null {
	if (!value || !/^https?:\/\//i.test(value)) return null;
	try {
		return new URL(value).href;
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
			.catch(() => {
				// Un fallo no se cachea: el siguiente intento vuelve a pedir.
				cached = null;
				return null;
			});
	}
	return cached;
}

/** Solo para tests. */
export function resetMediaBankUrlCache(): void {
	cached = null;
}
