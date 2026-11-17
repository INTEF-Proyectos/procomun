/**
 * Sirve al navegador el paquete extraído desde disco (#470, ADR-0046).
 *
 * El paquete se abre en un origen ficticio (`https://elpx-thumb.invalid/`) y
 * cada petición pasa por aquí: lo que está dentro de `storageDir/elpx/<hash>/`
 * se devuelve con las cabeceras de `routes/elpx-content.ts`, salvo la CSP del
 * HTML, que es propia: origen opaco y sin ventanas emergentes. Todo lo demás
 * (otros hosts, otros esquemas, `..`, enlaces simbólicos que salen del
 * paquete) se aborta. El contenido del autor no tiene red.
 */
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const PACKAGE_ORIGIN = "https://elpx-thumb.invalid";

/**
 * CSP propia de la captura (adenda 2026-11-04 de ADR-0046). Parte de
 * `ELPX_HTML_CSP` (apps/api/src/routes/elpx-content.ts): `sandbox` sin
 * `allow-same-origin` deja el JavaScript del autor en origen opaco. Además
 * quita `allow-popups` y `allow-popups-to-escape-sandbox`: el visor los
 * necesita para que el usuario abra enlaces, la captura no. Un test comprueba
 * que las demás directivas siguen siendo las de la API.
 */
export const CAPTURE_HTML_CSP =
	"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; frame-src 'self' https:; form-action 'self'; base-uri 'self'; sandbox allow-scripts allow-forms";

/** Copia de `AUTHOR_ASSET_CSP` de la API, para lo que no es HTML. */
export const AUTHOR_ASSET_CSP = "sandbox; default-src 'none'";

const MIME_TYPES: Record<string, string> = {
	html: "text/html",
	htm: "text/html",
	css: "text/css",
	js: "application/javascript",
	mjs: "application/javascript",
	json: "application/json",
	xml: "application/xml",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	svg: "image/svg+xml",
	webp: "image/webp",
	avif: "image/avif",
	ico: "image/x-icon",
	bmp: "image/bmp",
	woff: "font/woff",
	woff2: "font/woff2",
	ttf: "font/ttf",
	otf: "font/otf",
	eot: "application/vnd.ms-fontobject",
	txt: "text/plain",
};

/**
 * Audio y vídeo no aportan nada a la portada y pueden pesar cientos de MB:
 * no se leen.
 */
const SKIPPED_EXTENSIONS = new Set([
	"mp3",
	"mp4",
	"m4a",
	"m4v",
	"webm",
	"ogg",
	"ogv",
	"oga",
	"wav",
	"mov",
	"avi",
	"flv",
	"wmv",
	"mkv",
	"zip",
	"pdf",
]);

export type PackageResponse =
	| {
			action: "fulfill";
			status: number;
			headers: Record<string, string>;
			body: Uint8Array | string;
	  }
	| { action: "abort"; reason: string };

const notFound = (): PackageResponse => ({
	action: "fulfill",
	status: 404,
	headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
	body: "",
});

// eXe vuelve a escapar un título que ya venía escapado (`&amp;Iacute;`). La
// API lo corrige al servir el paquete; aquí también, para que la miniatura
// muestre el mismo texto que la ficha. Copia de decodeDoubleEscapedEntities.
const DOUBLE_ESCAPED_ENTITY = /&amp;(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g;
const HAS_DOUBLE_ESCAPED_ENTITY = /&amp;(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/;

export function decodeDoubleEscapedEntities(html: string): string {
	return html.replace(DOUBLE_ESCAPED_ENTITY, "&$1;");
}

/** Ruta relativa dentro del paquete, o `null` si intenta salir de él. */
export function packageRelativePath(pathname: string): string | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		return null;
	}
	if (decoded.includes("\0")) return null;
	const clean: string[] = [];
	for (const segment of decoded.replace(/\\/g, "/").split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") return null;
		clean.push(segment);
	}
	return clean.length === 0 ? "index.html" : clean.join("/");
}

function contentHeaders(ext: string): Record<string, string> {
	const isHtml = ext === "html" || ext === "htm";
	return {
		"Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
		"X-Content-Type-Options": "nosniff",
		"Cache-Control": "no-store",
		// El documento corre en origen opaco: sus fuentes y módulos se piden
		// en modo CORS, igual que con la API.
		"Access-Control-Allow-Origin": "*",
		"Content-Security-Policy": isHtml ? CAPTURE_HTML_CSP : AUTHOR_ASSET_CSP,
	};
}

/**
 * Decide qué contestar a una petición del navegador. `packageRoot` debe ser
 * ya una ruta real (`realpath`) del directorio del paquete.
 */
export async function resolvePackageRequest(
	packageRoot: string,
	request: { url: string; method: string },
	options: { maxAssetBytes: number },
): Promise<PackageResponse> {
	let url: URL;
	try {
		url = new URL(request.url);
	} catch {
		return { action: "abort", reason: "url-invalida" };
	}
	if (url.origin !== PACKAGE_ORIGIN)
		return { action: "abort", reason: "externa" };
	if (request.method !== "GET" && request.method !== "HEAD") {
		return { action: "abort", reason: "metodo" };
	}

	const relative = packageRelativePath(url.pathname);
	if (!relative) return notFound();
	const ext = path.extname(relative).slice(1).toLowerCase();
	if (SKIPPED_EXTENSIONS.has(ext))
		return { action: "abort", reason: "multimedia" };

	let real: string;
	try {
		real = await realpath(path.join(packageRoot, relative));
	} catch {
		return notFound();
	}
	// Frontera de separador: …/elpx/ab no contiene a …/elpx/abc.
	if (!real.startsWith(packageRoot + path.sep)) return notFound();

	const info = await stat(real).catch(() => null);
	if (!info?.isFile()) return notFound();
	if (info.size > options.maxAssetBytes) {
		return { action: "abort", reason: "demasiado-grande" };
	}

	const bytes = new Uint8Array(await readFile(real));
	const headers = contentHeaders(ext);
	if (ext === "html" || ext === "htm") {
		const html = decodeUtf8(bytes);
		if (html !== null && HAS_DOUBLE_ESCAPED_ENTITY.test(html)) {
			return {
				action: "fulfill",
				status: 200,
				headers,
				body: decodeDoubleEscapedEntities(html),
			};
		}
	}
	return { action: "fulfill", status: 200, headers, body: bytes };
}

/** Solo se reescribe un HTML en UTF-8 (lo que exporta eXe); otro, tal cual. */
function decodeUtf8(bytes: Uint8Array): string | null {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		return null;
	}
}
