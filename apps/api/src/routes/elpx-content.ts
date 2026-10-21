import { realpath } from "node:fs/promises";
import path from "node:path";
import * as repo from "@procomun/db/repository";
import { type Context, Hono } from "hono";
import { getDb } from "../db.ts";
import { getUploadConfig } from "../uploads/config.ts";

const MIME_TYPES: Record<string, string> = {
	html: "text/html",
	htm: "text/html",
	css: "text/css",
	js: "application/javascript",
	json: "application/json",
	xml: "application/xml",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	svg: "image/svg+xml",
	webp: "image/webp",
	ico: "image/x-icon",
	woff: "font/woff",
	woff2: "font/woff2",
	ttf: "font/ttf",
	eot: "application/vnd.ms-fontobject",
	otf: "font/otf",
	mp3: "audio/mpeg",
	mp4: "video/mp4",
	webm: "video/webm",
	ogg: "audio/ogg",
	ogv: "video/ogg",
	wav: "audio/wav",
	pdf: "application/pdf",
	zip: "application/zip",
	txt: "text/plain",
};

// Acepta UUIDs (36 caracteres, generación normal vía crypto.randomUUID()),
// hashes SHA-1 (40 caracteres) y hashes SHA-256 (64 caracteres, usados por el
// importador legacy Procomún para dedupe por contenido — ver ADR-0029). El
// límite superior coincide con elpx_projects.hash varchar(64).
const HASH_PATTERN = /^[a-f0-9-]{8,64}$/i;

// Script de promoción de embeds inyectado en el HTML del .elpx (ADR-0027).
const EMBED_SHIM_URL = "/api/v1/elpx/embed-shim.js";
// `crossorigin` para que el script se cargue en modo CORS: el contenido del
// .elpx se ejecuta en origen opaco (ADR-0026) y es embebible cross-origin, así
// que sus propios scripts deben pedirse con CORS (servimos ACAO `*`). Sin esto,
// el dev server de Vite los bloquea ("[Vite] Cross-origin requests for classic
// scripts must be made with CORS mode enabled").
const EMBED_SHIM_TAG = `<script src="${EMBED_SHIM_URL}" crossorigin="anonymous"></script>`;
// Los bytes servidos son el artefacto CANÓNICO vendorizado desde eXeLearning
// (ADR-0021: bytes + manifiesto, verificados en CI contra el buildHash del core),
// no una copia bespoke. La URL pública se mantiene porque ya está incrustada en
// los paquetes servidos; lo que cambia es de dónde salen los bytes.
const EMBED_SHIM_PATH = path.join(
	import.meta.dir,
	"../../static/elpx/exe_external_media/exe-external-media-child.min.js",
);
let embedShimCache: string | null = null;

async function readEmbedShim(): Promise<string> {
	if (embedShimCache === null) {
		embedShimCache = await Bun.file(EMBED_SHIM_PATH).text();
	}
	return embedShimCache;
}

/** Solo para tests: afirma QUÉ bytes se inyectan, sin levantar el servidor. */
export const readEmbedShimForTest = readEmbedShim;

// Añade crossorigin="anonymous" a los <script src="/api/v1/elpx/..."> propios
// del paquete para que se carguen en modo CORS bajo el origen opaco.
export function addCrossOriginToLocalScripts(html: string): string {
	return html.replace(
		/<script\b([^>]*\bsrc\s*=\s*["']\/api\/v1\/elpx\/[^"']*["'][^>]*)>/gi,
		(match, attrs) =>
			/\bcrossorigin\b/i.test(attrs)
				? match
				: `<script${attrs} crossorigin="anonymous">`,
	);
}

function injectEmbedShim(html: string): string {
	if (html.includes("</head>")) {
		return html.replace("</head>", `${EMBED_SHIM_TAG}</head>`);
	}
	return `${EMBED_SHIM_TAG}${html}`;
}

function sanitizePath(raw: string): string | null {
	let decoded: string;
	try {
		decoded = decodeURIComponent(raw);
	} catch {
		return null;
	}

	decoded = decoded.replace(/\0/g, "");
	decoded = decoded.replace(/\\/g, "/");

	const segments = decoded.split("/");
	const clean: string[] = [];

	for (const seg of segments) {
		if (seg === "" || seg === ".") continue;
		if (seg === "..") return null;
		clean.push(seg);
	}

	return clean.length === 0 ? "index.html" : clean.join("/");
}

function resolveRelativePath(baseDir: string, relativePath: string): string {
	if (!baseDir) return relativePath.replace(/^\.\//, "");
	const parts = `${baseDir}/${relativePath}`.split("/");
	const result: string[] = [];
	for (const part of parts) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			result.pop();
		} else {
			result.push(part);
		}
	}
	return result.join("/");
}

function rewriteRelativeUrls(
	html: string,
	baseUrl: string,
	currentFile: string,
): string {
	const currentDir = path.dirname(currentFile);
	const dir = currentDir === "." ? "" : currentDir;

	const attrPattern =
		/(<[^>]+\s)(src|href|poster|background)(\s*=\s*["'])(?!https?:\/\/|data:|\/\/|#|javascript:)([^"']+)(["'])/gi;
	html = html.replace(attrPattern, (match, prefix, attr, eq, url, quote) => {
		if (!url || url.startsWith("/")) return match;
		const resolved = resolveRelativePath(dir, url);
		return `${prefix}${attr}${eq}${baseUrl}${resolved}${quote}`;
	});

	html = html.replace(
		/url\s*\(\s*["']?(?!https?:\/\/|data:|\/\/|#)([^"')\s]+)["']?\s*\)/gi,
		(match, url) => {
			if (!url || url.startsWith("/")) return match;
			const resolved = resolveRelativePath(dir, url);
			return `url("${baseUrl}${resolved}")`;
		},
	);

	return decodeDoubleEscapedEntities(html);
}

// eXe vuelve a escapar un título que ya venía escapado (`&amp;Iacute;` se ve
// como el texto `&Iacute;`). Se quita un solo `amp;` y solo cuando abre una
// entidad completa. Un `&amp;` suelto se queda, y `&amp;lt;` pasa a `&lt;`,
// que el navegador pinta como texto y no como una etiqueta.
const DOUBLE_ESCAPED_ENTITY = /&amp;(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g;

export function decodeDoubleEscapedEntities(html: string): string {
	return html.replace(DOUBLE_ESCAPED_ENTITY, "&$1;");
}

function rewriteCssUrls(
	css: string,
	baseUrl: string,
	currentFile: string,
): string {
	const currentDir = path.dirname(currentFile);
	const dir = currentDir === "." ? "" : currentDir;

	return css.replace(
		/url\s*\(\s*["']?(?!https?:\/\/|data:|\/\/|#)([^"')\s]+)["']?\s*\)/gi,
		(match, url) => {
			if (!url || url.startsWith("/")) return match;
			const resolved = resolveRelativePath(dir, url);
			return `url("${baseUrl}${resolved}")`;
		},
	);
}

// Content-Security-Policy for the served .elpx HTML document. The `sandbox` directive
// forces an opaque origin (author JS runs but NOT as the authenticated platform origin),
// even when the document is opened top-level. It deliberately omits `allow-same-origin`
// and `allow-popups-to-escape-sandbox` (ADR-0026 + security audit H-1): a popup the
// content opens must stay sandboxed, or an author-controlled same-origin document could
// run script at the platform origin.
// Sin `frame-ancestors` a propósito (ADR-0026, adenda 2026-10-14). Este HTML
// es origen opaco y un iframe hijo del propio paquete (el reproductor de audio
// de eXeLearning, una diapositiva…) tiene ese origen como ancestro. Chromium y
// WebKit no lo casan con ninguna fuente, ni con `'self'` ni con `*`, y
// bloquean el hijo. Sin la directiva carga, y «Ponlo en tu web» también.
export const CONTENT_HTML_CSP =
	"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; frame-src 'self' https:; form-action 'self'; base-uri 'self'; sandbox allow-scripts allow-popups allow-forms";

/**
 * CSP para activos de autor no-HTML (SVG, CSS, binarios…).
 *
 * `sandbox` sin tokens: origen opaco y sin scripts si el recurso se navega
 * como documento de primer nivel. Imprescindible para SVG (image/svg+xml),
 * que puede contener <script> y provocar XSS almacenado (ADR-0026 + audit H-1).
 * `default-src 'none'` refuerza el aislamiento si el navegador interpreta el
 * recurso como documento con subrecursos. Para subresource loads
 * (<script>/<img>/<link>) el navegador ignora la CSP de la respuesta.
 */
export const AUTHOR_ASSET_CSP = "sandbox; default-src 'none'";

/** Alias histórico de la CSP de activos no-HTML (tests y llamadas previas). */
export const CONTENT_ASSET_CSP = AUTHOR_ASSET_CSP;

function authorAssetHeaders(contentType: string): Record<string, string> {
	return {
		"Content-Type": contentType,
		"X-Content-Type-Options": "nosniff",
		"Cache-Control": "public, max-age=3600",
		"Access-Control-Allow-Origin": "*",
		"Content-Security-Policy": AUTHOR_ASSET_CSP,
	};
}

/** Alias de main (#323): el valor canónico es CONTENT_HTML_CSP (sin escape de sandbox). */
export const ELPX_HTML_CSP = CONTENT_HTML_CSP;

export const elpxContentRoutes = new Hono();

export function remainingPathAfter(pathname: string, segment: string): string {
	const parts = pathname.split("/").filter(Boolean);
	const idx = parts.indexOf(segment);
	if (idx === -1) return "index.html";
	return parts.slice(idx + 1).join("/") || "index.html";
}

function elpxJsonError(error: string, status: number): Response {
	return Response.json(
		{ error },
		{
			status,
			headers: { "Access-Control-Allow-Origin": "*" },
		},
	);
}

export async function serveElpxExtractedContent(options: {
	hash: string;
	rawFile: string;
	rewriteBaseUrl: string;
	corsLocalScripts?: boolean;
}): Promise<Response> {
	const file = sanitizePath(options.rawFile);
	if (!file) return elpxJsonError("Ruta no válida", 404);

	const config = getUploadConfig();
	const basePath = path.join(config.storageDir, "elpx", options.hash);
	const fullPath = path.join(basePath, file);

	const bunFile = Bun.file(fullPath);
	if (!(await bunFile.exists())) {
		return elpxJsonError("Archivo no encontrado", 404);
	}

	try {
		const real = await realpath(fullPath);
		const realBase = await realpath(basePath);
		// Comparación con frontera de separador: evita que un prefijo común
		// (…/elpx/ab vs …/elpx/abc) se confunda con contención real.
		if (real !== realBase && !real.startsWith(realBase + path.sep)) {
			return elpxJsonError("Acceso denegado", 403);
		}
	} catch {
		// realpath may fail for edge cases; file existence already confirmed
	}

	const ext = path.extname(file).slice(1).toLowerCase();
	const mimeType = MIME_TYPES[ext] || "application/octet-stream";

	if (ext === "html" || ext === "htm") {
		const html = await Bun.file(fullPath).text();
		let rewritten = injectEmbedShim(
			rewriteRelativeUrls(html, options.rewriteBaseUrl, file),
		);
		if (options.corsLocalScripts !== false) {
			rewritten = addCrossOriginToLocalScripts(rewritten);
		}
		return new Response(rewritten, {
			headers: {
				"Content-Type": "text/html",
				"X-Content-Type-Options": "nosniff",
				"Referrer-Policy": "same-origin",
				"Cache-Control": "no-cache, must-revalidate",
				// El contenido del .elpx es embebible cross-origin y se ejecuta en
				// origen opaco, por lo que sus propios recursos se piden en modo CORS.
				"Access-Control-Allow-Origin": "*",
				// La directiva `sandbox` fuerza un origen opaco para el contenido de
				// autor del .elpx: el JS sigue ejecutándose (interactividad) pero NO
				// con el origen autenticado de la plataforma, aunque se abra en una
				// pestaña nueva. Sin `allow-same-origin` ni `allow-popups-to-escape-
				// sandbox` a propósito (ADR-0026 + auditoría H-1): un popup abierto por
				// el contenido debe seguir aislado.
				"Content-Security-Policy": CONTENT_HTML_CSP,
			},
		});
	}

	if (ext === "css") {
		const css = await Bun.file(fullPath).text();
		const rewritten = rewriteCssUrls(css, options.rewriteBaseUrl, file);
		return new Response(rewritten, {
			headers: authorAssetHeaders("text/css"),
		});
	}

	return new Response(Bun.file(fullPath), {
		headers: authorAssetHeaders(mimeType),
	});
}

async function handleContent(c: Context) {
	const hash = c.req.param("hash");
	if (!hash || !HASH_PATTERN.test(hash)) {
		return c.json({ error: "Identificador no válido" }, 404);
	}

	// RF-008 / issue #323: un hash extraído de una versión histórica no
	// se sirve por la API pública ordinaria.
	if (await repo.isElpxHashHistorical(getDb().db, hash)) {
		return c.json({ error: "Archivo no encontrado" }, 404);
	}

	const url = new URL(c.req.url);
	const rawFile = remainingPathAfter(url.pathname, hash);

	return serveElpxExtractedContent({
		hash,
		rawFile,
		rewriteBaseUrl: `/api/v1/elpx/${hash}/`,
		corsLocalScripts: true,
	});
}

// Ruta estática del shim de embeds. Debe registrarse ANTES de "/:hash" para
// que no la capture el patrón de hash (ADR-0027).
elpxContentRoutes.get("/embed-shim.js", async () => {
	const shim = await readEmbedShim();
	return new Response(shim, {
		headers: {
			"Content-Type": "application/javascript; charset=utf-8",
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "public, max-age=3600",
			"Access-Control-Allow-Origin": "*",
		},
	});
});

elpxContentRoutes.get("/:hash", handleContent);
elpxContentRoutes.get("/:hash/*", handleContent);
