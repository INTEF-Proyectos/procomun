import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import path from "node:path";
import * as repo from "@procomun/db/repository";
import * as cheerio from "cheerio";
import { type Context, Hono } from "hono";
import { getDb } from "../db.ts";
import {
	ELPX_PREVIEW_PREFIX,
	verifyElpxPreviewToken,
} from "../elpx/preview-token.ts";
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
const EMBED_SHIM_PATH = path.join(
	import.meta.dir,
	"../../static/elpx/embed-shim.js",
);
let embedShimCache: string | null = null;

async function readEmbedShim(): Promise<string> {
	if (embedShimCache === null) {
		embedShimCache = await Bun.file(EMBED_SHIM_PATH).text();
	}
	return embedShimCache;
}

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

// Valores de atributos data-*. eXe guarda ahí los datos de sus iDevices JSON
// (data-idevice-json-data) escapados como atributo; el navegador los resuelve
// igual que sin conexión, así que no se tocan (#431).
const DATA_ATTRIBUTE_VALUE = /(\sdata-[\w:.-]+\s*=\s*)("[^"]*"|'[^']*')/gi;

// url() con o sin comillas. Dentro de un style="…" las comillas van como
// &quot; o &#39;, y hay que conservarlas para no cerrar el atributo.
const CSS_URL =
	/url\s*\(\s*(&quot;|&#0?39;|&apos;|["']?)(?!https?:\/\/|data:|\/\/|#)((?:(?!&quot;|&#0?39;|&apos;)[^"')\s])+)\1\s*\)/gi;

function rewriteRelativeUrls(
	html: string,
	baseUrl: string,
	currentFile: string,
): string {
	const currentDir = path.dirname(currentFile);
	const dir = currentDir === "." ? "" : currentDir;

	// Se apartan con una marca única por petición y se devuelven al final.
	const mark = `procomun-data-${randomUUID()}`;
	const dataValues: string[] = [];
	html = html.replace(DATA_ATTRIBUTE_VALUE, (_match, prefix, value) => {
		dataValues.push(value);
		return `${prefix}"${mark}:${dataValues.length - 1}"`;
	});

	const attrPattern =
		/(<[^>]+\s)(src|href|poster|background)(\s*=\s*["'])(?!https?:\/\/|data:|\/\/|#|javascript:)([^"']+)(["'])/gi;
	html = html.replace(attrPattern, (match, prefix, attr, eq, url, quote) => {
		if (!url || url.startsWith("/")) return match;
		const resolved = resolveRelativePath(dir, url);
		return `${prefix}${attr}${eq}${baseUrl}${resolved}${quote}`;
	});

	html = html.replace(CSS_URL, (match, quote, url) => {
		if (!url || url.startsWith("/")) return match;
		const resolved = resolveRelativePath(dir, url);
		return `url(${quote}${baseUrl}${resolved}${quote})`;
	});

	return decodeDoubleEscapedEntities(html).replace(
		new RegExp(`"${mark}:(\\d+)"`, "g"),
		(_match, index) => dataValues[Number(index)] ?? '""',
	);
}

// iDevices con <component-type>json en su config.xml de eXe (salvo text, que
// se ve bien sin datos). Solo estos leen data-idevice-json-data.
const JSON_IDEVICE_TYPES = new Set([
	"adaptative-quiz",
	"casestudy",
	"digcompedu",
	"example",
	"file-attachment",
	"form",
	"image-gallery",
	"lomloe",
	"magnifier",
	"markdown-text",
	"scrambled-list",
	"slide",
	"three-d-viewer",
	"three-sixty-viewer",
	"trueorfalse",
]);

const IDEVICE_OPEN_TAG = /<div\b[^>]*\bclass="idevice_node\b[^>]*>/g;

function escapeAttr(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function ideviceJsonById(contentXml: string): Map<string, string> {
	const $ = cheerio.load(contentXml, { xml: true });
	const byId = new Map<string, string>();
	$("odeComponent").each((_i, el) => {
		const component = $(el);
		const id = component.children("odeIdeviceId").text().trim();
		const json = component.children("jsonProperties").text().trim();
		if (id && json) byId.set(id, json);
	});
	return byId;
}

// Los .elpx del Procomún antiguo traen el HTML exportado sin los datos de los
// iDevices JSON (el exportador no tenía su config.xml y los trató como HTML),
// así que eXe no monta, por ejemplo, los huecos de un formulario. Los datos
// siguen en content.xml; se ponen en el div como lo haría eXe (#431).
function restoreIdeviceJsonData(
	html: string,
	readContentXml: () => string | null,
	currentFile: string,
): string {
	let byId: Map<string, string> | null = null;
	const depth = currentFile.split("/").length - 1;
	const rootPrefix = "../".repeat(depth);
	return html.replace(IDEVICE_OPEN_TAG, (tag) => {
		if (/\sdata-idevice-component-type\s*=/.test(tag)) return tag;
		const type = tag.match(/\sdata-idevice-type="([^"]*)"/)?.[1];
		const id = tag.match(/\sid="([^"]*)"/)?.[1];
		if (!type || !id || !JSON_IDEVICE_TYPES.has(type)) return tag;
		byId ??= ideviceJsonById(readContentXml() ?? "");
		const raw = byId.get(id);
		if (!raw) return tag;
		try {
			const data = JSON.parse(raw);
			if (!data || typeof data !== "object" || Array.isArray(data)) return tag;
		} catch {
			return tag;
		}
		// eXe resuelve {{context_path}} al exportar, relativo a la página.
		const json = raw.replace(
			/\{\{context_path\}\}\/(content\/resources\/)?/g,
			`${rootPrefix}content/resources/`,
		);
		return `${tag.slice(0, -1)} data-idevice-component-type="json" data-idevice-json-data="${escapeAttr(json)}" data-idevice-template="${type}.html">`;
	});
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

/**
 * CSP para activos de autor no-HTML (SVG, CSS, binarios…).
 *
 * `sandbox` sin tokens: origen opaco y sin scripts si el recurso se navega
 * como documento de primer nivel. Imprescindible para SVG (image/svg+xml),
 * que puede contener <script> y provocar XSS almacenado (ADR-0026).
 * `default-src 'none'` refuerza el aislamiento si el navegador interpreta el
 * recurso como documento con subrecursos.
 */
export const AUTHOR_ASSET_CSP = "sandbox; default-src 'none'";

function authorAssetHeaders(contentType: string): Record<string, string> {
	return {
		"Content-Type": contentType,
		"X-Content-Type-Options": "nosniff",
		"Cache-Control": "public, max-age=3600",
		"Access-Control-Allow-Origin": "*",
		"Content-Security-Policy": AUTHOR_ASSET_CSP,
	};
}

// Sin `frame-ancestors` a propósito (ADR-0026, adenda 2026-10-14). Este HTML
// es origen opaco y un iframe hijo del propio paquete (el reproductor de audio
// de eXeLearning, una diapositiva…) tiene ese origen como ancestro. Chromium y
// WebKit no lo casan con ninguna fuente, ni con `'self'` ni con `*`, y
// bloquean el hijo. Sin la directiva carga, y «Ponlo en tu web» también.
export const ELPX_HTML_CSP =
	"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; frame-src 'self' https:; form-action 'self'; base-uri 'self'; sandbox allow-scripts allow-popups allow-forms allow-popups-to-escape-sandbox";

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
		// content.xml solo se lee si algún iDevice JSON viene sin sus datos.
		const html = restoreIdeviceJsonData(
			await Bun.file(fullPath).text(),
			() => {
				try {
					return readFileSync(path.join(basePath, "content.xml"), "utf8");
				} catch {
					return null;
				}
			},
			file,
		);
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
				// pestaña nueva. Sin `allow-same-origin` a propósito (ADR-0026).
				"Content-Security-Policy": ELPX_HTML_CSP,
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

	// Issue #466: por la URL estable solo se sirve lo publicado. Un enlace
	// guardado antes de despublicar o de volver a borrador deja de abrirse.
	// Quien puede ver el recurso recibe un enlace firmado (ver abajo).
	const owner = await repo.getElpxResourceStatusByHash(getDb().db, hash);
	if (owner?.editorialStatus !== "published") {
		return elpxJsonError("Archivo no encontrado", 404);
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

// Vista previa de un recurso no publicado (issue #466, ADR-0026 adenda
// 2026-10-27). El iframe de origen opaco no manda la cookie de sesión en los
// subrecursos ni en las subpáginas, así que el permiso viaja en la URL: un
// token HMAC de hash + caducidad que emiten las rutas que ya comprueban el
// acceso. Las URL relativas del paquete se reescriben con el mismo prefijo.
async function handleSignedPreview(c: Context) {
	const hash = c.req.param("hash");
	const token = c.req.param("token");
	if (!hash || !token || !HASH_PATTERN.test(hash)) {
		return elpxJsonError("Archivo no encontrado", 404);
	}
	if (!verifyElpxPreviewToken(hash, token)) {
		return elpxJsonError("Archivo no encontrado", 404);
	}
	if (await repo.isElpxHashHistorical(getDb().db, hash)) {
		return elpxJsonError("Archivo no encontrado", 404);
	}
	if (!(await repo.getElpxResourceStatusByHash(getDb().db, hash))) {
		return elpxJsonError("Archivo no encontrado", 404);
	}

	const base = `${ELPX_PREVIEW_PREFIX}/${hash}/${token}/`;
	const rawFile = remainingPathAfter(new URL(c.req.url).pathname, token);
	const response = await serveElpxExtractedContent({
		hash,
		rawFile,
		rewriteBaseUrl: base,
		corsLocalScripts: true,
	});
	// Revisión de #481: la miniatura de un recurso no publicado no se guarda en
	// ninguna caché, igual que la generada. El resto del paquete conserva la
	// caché de #483 para que la vista previa no descargue todo en cada página.
	if (response.ok && isRootScreenshot(rawFile)) {
		response.headers.set("Cache-Control", "private, no-store");
	}
	return response;
}

function isRootScreenshot(rawFile: string): boolean {
	try {
		return decodeURIComponent(rawFile) === "screenshot.png";
	} catch {
		return false;
	}
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

elpxContentRoutes.get("/preview/:hash/:token", handleSignedPreview);
elpxContentRoutes.get("/preview/:hash/:token/*", handleSignedPreview);
elpxContentRoutes.get("/:hash", handleContent);
elpxContentRoutes.get("/:hash/*", handleContent);
