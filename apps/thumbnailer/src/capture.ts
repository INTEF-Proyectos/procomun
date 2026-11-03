/**
 * Captura de la portada de un paquete (#470, ADR-0046).
 *
 * Abre `index.html` en un contexto nuevo y vacío (sin cookies, sin
 * almacenamiento, sin service workers, sin descargas), con todas las
 * peticiones interceptadas por `package-files.ts`. Esconde la navegación de
 * eXe, espera a que pinte, comprueba que haya algo visible y devuelve un JPEG
 * de 640×400: ventana de 1280×800 con `deviceScaleFactor` 0,5, así que
 * Chromium entrega el tamaño final sin redimensionar.
 *
 * Los tipos de navegador son el mínimo que se usa de Playwright, para poder
 * probar la lógica sin lanzar Chromium.
 */
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { PACKAGE_ORIGIN, resolvePackageRequest } from "./package-files.ts";

export const VIEWPORT = { width: 1280, height: 800 } as const;
export const DEVICE_SCALE_FACTOR = 0.5;
/** Calidades que se prueban, de mejor a peor, hasta caber en el límite. */
export const JPEG_QUALITIES = [80, 65, 50] as const;
/** `?nav=false` hace que el tema de eXe arranque con el menú cerrado. */
export const COVER_URL = `${PACKAGE_ORIGIN}/index.html?nav=false`;
const CLOSE_TIMEOUT_MS = 5_000;

/**
 * Navegación y adornos de eXe (2.x a 4.x) que no son contenido: menú,
 * botones del tema, buscador, paginación, contador, pie y «Creado con
 * eXeLearning». Sin animaciones ni barras de desplazamiento en la captura.
 */
export const HIDE_CHROME_CSS = `
#siteNav, #sidebar-nav, #siteNavToggler, #searchBarTogger, #skipNav,
#exe-client-search, #nav-toggler, #topPagination, #bottomPagination,
.nav-buttons, .page-counter, #teacher-mode-toggler-wrapper,
#siteFooter, #made-with-eXe { display: none !important; }
.exe-web-site .exe-content { box-shadow: none !important; }
html, body { overflow: hidden !important; scrollbar-width: none !important; }
*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
`;

/**
 * Se evalúa en la página: cuenta el texto visible y las imágenes que se ven
 * en la ventana. Va como cadena para que no dependa de cómo se transpile.
 */
export const VISIBLE_CONTENT_SCRIPT = `(() => {
	document.body && document.body.classList.add("siteNav-off");
	const body = document.body;
	if (!body) return { textLength: 0, mediaCount: 0 };
	const textLength = (body.innerText || "").replace(/\\s+/g, "").length;
	const width = window.innerWidth;
	const height = window.innerHeight;
	let mediaCount = 0;
	for (const el of document.querySelectorAll("img, svg, canvas, video, picture, object, embed, iframe")) {
		const box = el.getBoundingClientRect();
		if (box.width < 24 || box.height < 24) continue;
		if (box.bottom <= 0 || box.right <= 0 || box.top >= height || box.left >= width) continue;
		const style = getComputedStyle(el);
		if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
		if (el.tagName === "IMG" && !(el.complete && el.naturalWidth > 0)) continue;
		mediaCount++;
	}
	return { textLength, mediaCount };
})()`;

const FONTS_READY_SCRIPT =
	"document.fonts ? document.fonts.ready.then(() => true) : true";

export type VisibleContent = { textLength: number; mediaCount: number };

export function isEmptyCover(content: VisibleContent): boolean {
	return content.textLength === 0 && content.mediaCount === 0;
}

export interface RouteLike {
	request(): { url(): string; method(): string };
	fulfill(response: {
		status: number;
		headers: Record<string, string>;
		body: string | Buffer;
	}): Promise<void>;
	abort(errorCode?: string): Promise<void>;
}

export interface PageLike {
	goto(
		url: string,
		options: { waitUntil: "load"; timeout: number },
	): Promise<unknown>;
	evaluate(expression: string): Promise<unknown>;
	addStyleTag(options: { content: string }): Promise<unknown>;
	waitForTimeout(ms: number): Promise<void>;
	/** URL actual: el paquete puede haber navegado a otra página. */
	url(): string;
	screenshot(options: {
		type: "jpeg";
		quality: number;
		timeout: number;
		animations: "disabled";
		caret: "hide";
	}): Promise<Uint8Array>;
}

export interface ContextLike {
	route(
		url: string,
		handler: (route: RouteLike) => Promise<void>,
	): Promise<unknown>;
	newPage(): Promise<PageLike>;
	close(): Promise<void>;
}

export type ContextOptions = {
	viewport: { width: number; height: number };
	deviceScaleFactor: number;
	serviceWorkers: "block";
	acceptDownloads: false;
	javaScriptEnabled: true;
	bypassCSP: false;
	reducedMotion: "reduce";
	colorScheme: "light";
	locale: string;
	timezoneId: string;
	permissions: string[];
};

export interface BrowserLike {
	/** Contexto aislado con las peticiones interceptadas y la página nueva. */
	newContext(options: ContextOptions): Promise<ContextLike>;
}

export type CaptureOptions = {
	timeoutMs: number;
	settleMs: number;
	maxImageBytes: number;
	maxAssetBytes: number;
	/** Espera máxima al cerrar el contexto antes de dar el navegador por malo. */
	closeTimeoutMs?: number;
	now?: () => number;
};

export type CaptureResult =
	| { status: "ok"; bytes: Uint8Array; quality: number }
	| { status: "empty" }
	| { status: "not_found"; message: string }
	| { status: "timeout"; message: string }
	| { status: "error"; message: string };

/** `browserSuspect`: el navegador puede haber quedado mal; conviene relanzarlo. */
export type CaptureOutcome = { result: CaptureResult; browserSuspect: boolean };

export const CONTEXT_OPTIONS: ContextOptions = {
	viewport: { ...VIEWPORT },
	deviceScaleFactor: DEVICE_SCALE_FACTOR,
	serviceWorkers: "block",
	acceptDownloads: false,
	javaScriptEnabled: true,
	// Nunca: desactivaría también la directiva `sandbox` de la CSP.
	bypassCSP: false,
	reducedMotion: "reduce",
	colorScheme: "light",
	locale: "es-ES",
	timezoneId: "Europe/Madrid",
	permissions: [],
};

class CaptureTimeout extends Error {}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new CaptureTimeout()), Math.max(0, ms));
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function message(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/** Intercepta todas las peticiones del contexto contra el paquete en disco. */
export function packageRouteHandler(
	packageRoot: string,
	options: { maxAssetBytes: number },
) {
	return async (route: RouteLike) => {
		try {
			const request = route.request();
			const response = await resolvePackageRequest(
				packageRoot,
				{ url: request.url(), method: request.method() },
				options,
			);
			if (response.action === "abort") {
				await route.abort("blockedbyclient");
				return;
			}
			await route.fulfill({
				status: response.status,
				headers: response.headers,
				body:
					typeof response.body === "string"
						? response.body
						: Buffer.from(response.body),
			});
		} catch {
			await route.abort("failed").catch(() => {});
		}
	};
}

async function screenshotWithinLimit(
	page: PageLike,
	options: { maxImageBytes: number; remaining: () => number },
): Promise<{ bytes: Uint8Array; quality: number }> {
	let best: { bytes: Uint8Array; quality: number } | null = null;
	for (const quality of JPEG_QUALITIES) {
		const bytes = new Uint8Array(
			await page.screenshot({
				type: "jpeg",
				quality,
				timeout: Math.max(1, options.remaining()),
				animations: "disabled",
				caret: "hide",
			}),
		);
		best = { bytes, quality };
		if (bytes.byteLength <= options.maxImageBytes) break;
	}
	if (!best) throw new Error("sin captura");
	return best;
}

export async function captureThumbnail(
	browser: BrowserLike,
	packageDir: string,
	options: CaptureOptions,
): Promise<CaptureOutcome> {
	const now = options.now ?? Date.now;
	const deadline = now() + options.timeoutMs;
	const remaining = () => deadline - now();

	let packageRoot: string;
	try {
		packageRoot = await realpath(packageDir);
		const index = await stat(path.join(packageRoot, "index.html"));
		if (!index.isFile()) throw new Error("index.html no es un fichero");
	} catch {
		return {
			result: { status: "not_found", message: "paquete sin index.html" },
			browserSuspect: false,
		};
	}

	let context: ContextLike | null = null;
	let abandoned = false;
	let browserSuspect = false;
	let result: CaptureResult;
	try {
		result = await withDeadline(
			(async (): Promise<CaptureResult> => {
				const created = await browser.newContext(CONTEXT_OPTIONS);
				context = created;
				// Si el tiempo ya se agotó, nadie va a cerrar este contexto.
				if (abandoned) {
					await created.close().catch(() => {});
					throw new CaptureTimeout();
				}
				await created.route("**/*", packageRouteHandler(packageRoot, options));
				const page = await created.newPage();
				await page.goto(COVER_URL, {
					waitUntil: "load",
					timeout: Math.max(1, remaining()),
				});
				await page.evaluate(FONTS_READY_SCRIPT);
				await page.addStyleTag({ content: HIDE_CHROME_CSS });
				const content = (await page.evaluate(
					VISIBLE_CONTENT_SCRIPT,
				)) as VisibleContent;
				await page.waitForTimeout(options.settleMs);
				// Si la portada se fue a otra web, lo que hay es la página de
				// error de Chromium (la navegación se abortó): no se captura.
				if (!page.url().startsWith(`${PACKAGE_ORIGIN}/`)) {
					return { status: "error", message: "la portada salió del paquete" };
				}
				if (isEmptyCover(content)) return { status: "empty" };
				const shot = await screenshotWithinLimit(page, {
					maxImageBytes: options.maxImageBytes,
					remaining,
				});
				return { status: "ok", ...shot };
			})(),
			remaining(),
		);
	} catch (err) {
		// Un bucle infinito del autor bloquea el hilo de la página: se corta
		// por tiempo y el navegador se relanza por si quedó colgado.
		abandoned = true;
		const timedOut =
			err instanceof CaptureTimeout || /timeout/i.test(message(err));
		browserSuspect = timedOut;
		result = timedOut
			? {
					status: "timeout",
					message: `la portada no terminó en ${options.timeoutMs} ms`,
				}
			: { status: "error", message: message(err) };
	}

	const opened = context as ContextLike | null;
	if (opened) {
		try {
			await withDeadline(
				opened.close(),
				options.closeTimeoutMs ?? CLOSE_TIMEOUT_MS,
			);
		} catch {
			browserSuspect = true;
		}
	}
	return { result, browserSuspect };
}
