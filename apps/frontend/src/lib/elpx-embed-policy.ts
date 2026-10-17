/**
 * Política de promoción de embeds de un `.elpx` (ADR-0027).
 *
 * El contenido del `.elpx` se sirve con origen opaco (sandbox sin
 * `allow-same-origin`, ADR-0026). El sandbox se hereda por los iframes
 * anidados, así que los embeds de vídeo (YouTube/Vimeo/…) y el visor de PDF que
 * mete el autor quedan con origen `null` y se rompen. La solución es
 * "promover" esos embeds a un player de confianza que crea Procomún en el frame
 * principal (modal), cargando la URL del proveedor directamente. Ese iframe del
 * proveedor es same-origin a sí mismo (p.ej. youtube.com) y queda aislado de
 * Procomún por la Same-Origin Policy.
 *
 * Este módulo es el NÚCLEO DE SEGURIDAD de esa promoción: decide, a partir de
 * una URL reportada por el shim, si se promociona y como qué tipo. No confía en
 * el shim (que solo hace una detección coarse); aquí está la validación
 * autoritativa.
 *
 * INVARIANTE CRÍTICO: un embed de tipo vídeo SOLO se promociona si es
 * cross-origin https. Nunca same-origin, para que una URL maliciosa al propio
 * origen (de la app o del contenido) no se cargue con `allow-same-origin` en el
 * modal y escape del aislamiento.
 */

export type EmbedKind = "video" | "pdf";

export type EmbedClassification = { kind: EmbedKind; url: string };

export type ClassifyOptions = {
	/** Origen de la app/frame principal donde se abrirá el modal. */
	pageOrigin: string;
	/**
	 * URL base del contenido del `.elpx` servido (el `src` del iframe de
	 * preview, p.ej. `https://api.example/api/v1/elpx/<hash>/index.html`). Sirve
	 * para permitir PDFs del propio paquete y para rechazar vídeos same-origin al
	 * contenido.
	 */
	contentBaseUrl?: string;
};

const PDF_PATH_RE = /\.pdf$/i;

function safeUrl(raw: string): URL | null {
	try {
		// Solo URLs absolutas: el shim siempre reporta la URL resuelta a absoluta.
		return new URL(raw);
	} catch {
		return null;
	}
}

// La ficha pasa `previewUrl` tal cual la da la API, relativa (#378).
function resolveBase(
	raw: string | undefined,
	pageOrigin: string,
): string | undefined {
	if (!raw) return undefined;
	try {
		return new URL(raw, pageOrigin).href;
	} catch {
		return undefined;
	}
}

function hostOf(rawOrigin: string | undefined): string | null {
	if (!rawOrigin) return null;
	try {
		return new URL(rawOrigin).hostname.toLowerCase();
	} catch {
		return null;
	}
}

/**
 * URL canónica para proveedores conocidos (mejora de privacidad/robustez). En
 * modo abierto, los hosts no conocidos se devuelven validados tal cual.
 */
export function canonicalizeProvider(url: URL): string {
	const host = url.hostname.toLowerCase();

	// YouTube → youtube-nocookie (sin cookies de seguimiento).
	if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) {
		const m = url.pathname.match(/^\/embed\/([A-Za-z0-9_-]{6,})/);
		if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
	}
	if (/(^|\.)youtu\.be$/.test(host)) {
		const m = url.pathname.match(/^\/([A-Za-z0-9_-]{6,})/);
		if (m) return `https://www.youtube-nocookie.com/embed/${m[1]}`;
	}

	return url.href;
}

function isUnderPackageBase(url: URL, contentBaseUrl?: string): boolean {
	if (!contentBaseUrl) return false;
	const base = safeUrl(contentBaseUrl);
	if (!base) return false;
	if (url.origin !== base.origin) return false;
	// Base del paquete = directorio del documento servido (…/elpx/<hash>/).
	const baseDir = base.pathname.slice(0, base.pathname.lastIndexOf("/") + 1);
	return url.pathname.startsWith(baseDir);
}

/**
 * Decide si una URL embebida se promociona y con qué tipo de player.
 * Devuelve `null` si NO debe promocionarse.
 */
export function classifyEmbed(
	rawUrl: string,
	opts: ClassifyOptions,
): EmbedClassification | null {
	const url = safeUrl(rawUrl);
	if (!url) return null;

	// Rechaza credenciales en la URL (https://evil@youtube.com/…).
	if (url.username || url.password) return null;

	const contentBase = resolveBase(opts.contentBaseUrl, opts.pageOrigin);

	// PDF del propio paquete: mismo origen que el contenido, que puede ir por
	// http (desarrollo o un despliegue sin TLS).
	if (PDF_PATH_RE.test(url.pathname) && isUnderPackageBase(url, contentBase)) {
		return { kind: "pdf", url: url.href };
	}

	// Solo https.
	if (url.protocol !== "https:") return null;

	const pageHost = hostOf(opts.pageOrigin);
	const contentHost = hostOf(contentBase);
	const host = url.hostname.toLowerCase();

	// --- PDF remoto ---
	if (PDF_PATH_RE.test(url.pathname)) {
		const crossOrigin = host !== pageHost && host !== contentHost;
		return crossOrigin ? { kind: "pdf", url: url.href } : null;
	}

	// --- Vídeo (cualquier iframe https cross-origin: modo abierto) ---
	// INVARIANTE: nunca same-origin a la app ni al contenido.
	if (host === pageHost || host === contentHost) return null;

	return { kind: "video", url: canonicalizeProvider(url) };
}
