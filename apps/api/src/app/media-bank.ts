/**
 * URL del banco multimedia externo (#569). Procomún no tiene banco propio: solo
 * enlaza con la aplicación del banco. Sin `MEDIA_BANK_URL`, o con un valor que
 * no sea una URL http(s) absoluta, devuelve `null` y el frontend no muestra el
 * enlace. Exige `http://` o `https://` literal: `new URL` acepta
 * `https:banco.example.org`, que el navegador resolvería como ruta interna.
 */
export function resolveMediaBankUrl(
	env: Record<string, string | undefined>,
): string | null {
	const raw = env.MEDIA_BANK_URL?.trim();
	if (!raw || !/^https?:\/\//i.test(raw)) return null;
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return null;
	}
	return parsed.href;
}
