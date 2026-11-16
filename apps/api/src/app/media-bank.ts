/**
 * URL del banco multimedia externo (#569). Procomún no tiene banco propio: solo
 * enlaza con la aplicación del banco. Sin `MEDIA_BANK_URL`, o con un valor que
 * no sea una URL http(s) absoluta, devuelve `null` y el frontend no muestra el
 * enlace.
 */
export function resolveMediaBankUrl(
	env: Record<string, string | undefined>,
): string | null {
	const raw = env.MEDIA_BANK_URL?.trim();
	if (!raw) return null;
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return null;
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
	return raw;
}
