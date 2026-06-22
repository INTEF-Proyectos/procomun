import { Hono } from "hono";
import path from "node:path";
import { realpath } from "node:fs/promises";
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

// Accept both SHA-1 hashes (40 hex chars) and UUIDs
const HASH_PATTERN = /^[a-f0-9-]{8,40}$/i;

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

function rewriteRelativeUrls(
	html: string,
	hash: string,
	currentFile: string,
): string {
	const baseUrl = `/api/v1/elpx/${hash}/`;
	const currentDir = path.dirname(currentFile);
	const dir = currentDir === "." ? "" : currentDir;

	const attrPattern =
		/(<[^>]+\s)(src|href|poster)(\s*=\s*["'])(?!https?:\/\/|data:|\/\/|#|javascript:)([^"']+)(["'])/gi;
	html = html.replace(
		attrPattern,
		(match, prefix, attr, eq, url, quote) => {
			if (!url || url.startsWith("/")) return match;
			const resolved = resolveRelativePath(dir, url);
			return `${prefix}${attr}${eq}${baseUrl}${resolved}${quote}`;
		},
	);

	html = html.replace(
		/url\s*\(\s*["']?(?!https?:\/\/|data:|\/\/|#)([^"')\s]+)["']?\s*\)/gi,
		(match, url) => {
			if (!url || url.startsWith("/")) return match;
			const resolved = resolveRelativePath(dir, url);
			return `url("${baseUrl}${resolved}")`;
		},
	);

	return html;
}

function rewriteCssUrls(
	css: string,
	hash: string,
	currentFile: string,
): string {
	const baseUrl = `/api/v1/elpx/${hash}/`;
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

export const elpxContentRoutes = new Hono();

async function handleContent(c: any) {
	const hash = c.req.param("hash");
	if (!hash || !HASH_PATTERN.test(hash)) {
		return c.json({ error: "Identificador no válido" }, 404);
	}

	const url = new URL(c.req.url);
	const pathParts = url.pathname.split("/");
	const hashIndex = pathParts.indexOf(hash);
	const rawFile = pathParts.slice(hashIndex + 1).join("/") || "index.html";

	const file = sanitizePath(rawFile);
	if (!file) return c.json({ error: "Ruta no válida" }, 404);

	const config = getUploadConfig();
	const basePath = path.join(config.storageDir, "elpx", hash);
	const fullPath = path.join(basePath, file);

	const bunFile = Bun.file(fullPath);
	if (!(await bunFile.exists())) {
		return c.json({ error: "Archivo no encontrado" }, 404);
	}

	try {
		const real = await realpath(fullPath);
		const realBase = await realpath(basePath);
		if (!real.startsWith(realBase)) {
			return c.json({ error: "Acceso denegado" }, 403);
		}
	} catch {
		// realpath may fail for edge cases; file existence already confirmed
	}

	const ext = path.extname(file).slice(1).toLowerCase();
	const mimeType = MIME_TYPES[ext] || "application/octet-stream";

	if (ext === "html" || ext === "htm") {
		const html = await Bun.file(fullPath).text();
		const rewritten = addCrossOriginToLocalScripts(
			injectEmbedShim(rewriteRelativeUrls(html, hash, file)),
		);
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
				"Content-Security-Policy":
					"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; frame-src 'self' https:; frame-ancestors 'self'; form-action 'self'; base-uri 'self'; sandbox allow-scripts allow-popups allow-forms allow-popups-to-escape-sandbox",
			},
		});
	}

	if (ext === "css") {
		const css = await Bun.file(fullPath).text();
		const rewritten = rewriteCssUrls(css, hash, file);
		return new Response(rewritten, {
			headers: {
				"Content-Type": "text/css",
				"X-Content-Type-Options": "nosniff",
				"Cache-Control": "public, max-age=3600",
				"Access-Control-Allow-Origin": "*",
			},
		});
	}

	return new Response(Bun.file(fullPath), {
		headers: {
			"Content-Type": mimeType,
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "public, max-age=3600",
			"Access-Control-Allow-Origin": "*",
		},
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
