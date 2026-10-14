const COVER_NAME =
	/^(cover|portada|thumbnail|miniatura)\.(png|jpe?g|gif|webp|svg)$/i;
const DENY_PREFIX = /^(theme|libs|idevices|content\/css|content\/img)\//i;
const DENY_FILE =
	/(^|\/)(screenshot\.png|icons\.png|licenses\.gif|favicon\.ico|exe_powered_logo\.png)$/i;
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

/** Ruta interna del paquete, sin query ni prefijo público `/elpx/<hash>/`. */
export function normalizePackagePath(raw: string): string {
	const noQuery = raw.split("?")[0]?.split("#")[0] ?? raw;
	let value = noQuery;
	try {
		if (/^https?:\/\//i.test(value)) value = new URL(value).pathname;
	} catch {
		// Se conserva la cadena original si no es una URL absoluta válida.
	}
	const marker = value.match(/\/elpx\/[^/]+\/(.+)$/);
	if (marker?.[1]) value = marker[1];
	return value.replace(/^\.\//, "").replace(/^\/+/, "");
}

export function isElpxCoverImagePath(raw: string): boolean {
	const rel = normalizePackagePath(raw);
	if (!rel || rel.includes("..")) return false;
	if (DENY_PREFIX.test(rel) || DENY_FILE.test(rel)) return false;
	const base = rel.split("/").pop() ?? "";
	return COVER_NAME.test(base);
}

function coverRank(rel: string): number {
	const base = (rel.split("/").pop() ?? "").toLowerCase();
	if (base.startsWith("cover.")) return 0;
	if (base.startsWith("portada.")) return 1;
	if (base.startsWith("thumbnail.")) return 2;
	return 3;
}

/**
 * Elige la imagen de portada del paquete. No usa assets del tema, librerías
 * ni el primer fichero que parezca imagen.
 */
export function selectElpxCoverImage(
	entries: readonly string[],
): string | null {
	const matches = entries
		.map((entry) => normalizePackagePath(entry))
		.filter((entry) => isElpxCoverImagePath(entry));
	if (matches.length === 0) return null;
	return (
		[...matches].sort(
			(a, b) =>
				coverRank(a) - coverRank(b) || a.length - b.length || (a < b ? -1 : 1),
		)[0] ?? null
	);
}

/** URL http(s) de miniatura ajena al paquete, nunca un HTML ni un asset de tema. */
export function isExternalCoverUrl(raw: string): boolean {
	if (!/^https?:\/\//i.test(raw)) return false;
	const rel = normalizePackagePath(raw);
	if (!rel || DENY_PREFIX.test(rel) || DENY_FILE.test(rel)) return false;
	if (rel.includes("/elpx/")) return false;
	const ext = rel.split(".").pop()?.toLowerCase() ?? "";
	return IMAGE_EXT.has(ext);
}
