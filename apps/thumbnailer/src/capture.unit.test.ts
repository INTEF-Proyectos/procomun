import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	type BrowserLike,
	CONTEXT_OPTIONS,
	COVER_URL,
	type ContextLike,
	type ContextOptions,
	captureThumbnail,
	HIDE_CHROME_CSS,
	isEmptyCover,
	type PageLike,
	packageRouteHandler,
	type RouteLike,
	VISIBLE_CONTENT_SCRIPT,
} from "./capture.ts";
import { PACKAGE_ORIGIN } from "./package-files.ts";

const OPTIONS = {
	timeoutMs: 1000,
	settleMs: 1,
	maxImageBytes: 100,
	maxAssetBytes: 1024,
	closeTimeoutMs: 50,
};
const never = () => new Promise<never>(() => {});

let base: string;
let packageDir: string;

beforeAll(async () => {
	base = await mkdtemp(path.join(tmpdir(), "thumb-capture-"));
	packageDir = path.join(base, "elpx", "abc12345");
	await mkdir(packageDir, { recursive: true });
	await writeFile(path.join(packageDir, "index.html"), "<h1>Portada</h1>");
});

afterAll(async () => {
	if (base) await rm(base, { recursive: true, force: true });
});

type FakeOptions = {
	content?: { textLength: number; mediaCount: number };
	sizes?: number[];
	goto?: () => Promise<unknown>;
	close?: () => Promise<void>;
	newContextDelayMs?: number;
	url?: string;
};

function fakeBrowser(options: FakeOptions = {}) {
	const log: string[] = [];
	const contexts: ContextOptions[] = [];
	const qualities: number[] = [];
	let routeHandler: ((route: RouteLike) => Promise<void>) | null = null;
	let closed = 0;
	const sizes = [...(options.sizes ?? [10])];
	const page: PageLike = {
		async goto(url, opts) {
			log.push(`goto ${url} ${opts.waitUntil}`);
			return options.goto ? options.goto() : null;
		},
		async evaluate(expression) {
			if (expression === VISIBLE_CONTENT_SCRIPT) {
				log.push("detect");
				return options.content ?? { textLength: 10, mediaCount: 0 };
			}
			log.push("fonts");
			return true;
		},
		async addStyleTag({ content }) {
			log.push(content === HIDE_CHROME_CSS ? "hide-chrome" : "style");
		},
		async waitForTimeout() {
			log.push("settle");
		},
		url: () => options.url ?? `${PACKAGE_ORIGIN}/index.html?nav=false`,
		async screenshot(opts) {
			qualities.push(opts.quality);
			const size = sizes.shift() ?? 10;
			const bytes = new Uint8Array(size);
			bytes.set([0xff, 0xd8, 0xff]);
			return bytes;
		},
	};
	const context: ContextLike = {
		async route(url, handler) {
			log.push(`route ${url}`);
			routeHandler = handler;
		},
		async newPage() {
			return page;
		},
		async close() {
			closed++;
			if (options.close) await options.close();
		},
	};
	const browser: BrowserLike = {
		async newContext(opts) {
			contexts.push(opts);
			if (options.newContextDelayMs) await Bun.sleep(options.newContextDelayMs);
			return context;
		},
	};
	return {
		browser,
		log,
		contexts,
		qualities,
		get closed() {
			return closed;
		},
		get routeHandler() {
			return routeHandler;
		},
	};
}

describe("captureThumbnail (#470)", () => {
	test("sin index.html no abre el navegador", async () => {
		const fake = fakeBrowser();
		const outcome = await captureThumbnail(
			fake.browser,
			path.join(base, "no-existe"),
			OPTIONS,
		);
		expect(outcome).toEqual({
			result: { status: "not_found", message: "paquete sin index.html" },
			browserSuspect: false,
		});
		expect(fake.contexts).toEqual([]);
	});

	test("abre la portada aislada, esconde la navegación y captura 640×400", async () => {
		const fake = fakeBrowser();

		const outcome = await captureThumbnail(fake.browser, packageDir, OPTIONS);

		expect(outcome.result).toMatchObject({ status: "ok", quality: 80 });
		expect(outcome.browserSuspect).toBe(false);
		expect(fake.contexts).toEqual([CONTEXT_OPTIONS]);
		expect(CONTEXT_OPTIONS).toMatchObject({
			viewport: { width: 1280, height: 800 },
			deviceScaleFactor: 0.5,
			serviceWorkers: "block",
			acceptDownloads: false,
			bypassCSP: false,
		});
		expect(fake.log).toEqual([
			"route **/*",
			`goto ${COVER_URL} load`,
			"fonts",
			"hide-chrome",
			// Se mide después de la espera (revisión de #512).
			"settle",
			"detect",
		]);
		expect(COVER_URL).toBe(`${PACKAGE_ORIGIN}/index.html?nav=false`);
		expect(fake.closed).toBe(1);
	});

	test("baja la calidad hasta caber en el límite", async () => {
		const fits = fakeBrowser({ sizes: [500, 90] });
		const result = (await captureThumbnail(fits.browser, packageDir, OPTIONS))
			.result;
		expect(result).toMatchObject({ status: "ok", quality: 65 });
		expect(fits.qualities).toEqual([80, 65]);

		const never_fits = fakeBrowser({ sizes: [500, 400, 300] });
		const last = (
			await captureThumbnail(never_fits.browser, packageDir, OPTIONS)
		).result;
		expect(last).toMatchObject({ status: "ok", quality: 50 });
		if (last.status === "ok") expect(last.bytes.byteLength).toBe(300);
	});

	test("una portada sin nada visible es empty y no se captura", async () => {
		const fake = fakeBrowser({ content: { textLength: 0, mediaCount: 0 } });
		const outcome = await captureThumbnail(fake.browser, packageDir, OPTIONS);
		expect(outcome.result).toEqual({ status: "empty" });
		expect(fake.qualities).toEqual([]);
		expect(fake.closed).toBe(1);
	});

	test("corta por tiempo y marca el navegador como sospechoso", async () => {
		const fake = fakeBrowser({ goto: never });
		const outcome = await captureThumbnail(fake.browser, packageDir, {
			...OPTIONS,
			timeoutMs: 30,
		});
		expect(outcome).toEqual({
			result: { status: "timeout", message: "la portada no terminó en 30 ms" },
			browserSuspect: true,
		});
		expect(fake.closed).toBe(1);
	});

	test("el timeout de Playwright también cuenta como tiempo agotado", async () => {
		const fake = fakeBrowser({
			goto: async () => {
				throw new Error("page.goto: Timeout 1000ms exceeded.");
			},
		});
		const outcome = await captureThumbnail(fake.browser, packageDir, OPTIONS);
		expect(outcome.result.status).toBe("timeout");
	});

	test("otro error se informa sin culpar al navegador", async () => {
		const fake = fakeBrowser({
			goto: async () => {
				throw new Error("net::ERR_ABORTED");
			},
		});
		expect(await captureThumbnail(fake.browser, packageDir, OPTIONS)).toEqual({
			result: { status: "error", message: "net::ERR_ABORTED" },
			browserSuspect: false,
		});
	});

	test("si la portada se va fuera del paquete no captura la página de error", async () => {
		const fake = fakeBrowser({ url: "chrome-error://chromewebdata/" });
		expect(await captureThumbnail(fake.browser, packageDir, OPTIONS)).toEqual({
			result: { status: "error", message: "la portada salió del paquete" },
			browserSuspect: false,
		});
		expect(fake.qualities).toEqual([]);
	});

	test("si el contexto no cierra, el navegador es sospechoso", async () => {
		const fake = fakeBrowser({ close: never });
		const outcome = await captureThumbnail(fake.browser, packageDir, OPTIONS);
		expect(outcome.result.status).toBe("ok");
		expect(outcome.browserSuspect).toBe(true);
	});

	test("cierra el contexto que llega cuando ya se había agotado el tiempo", async () => {
		const fake = fakeBrowser({ newContextDelayMs: 60 });
		const outcome = await captureThumbnail(fake.browser, packageDir, {
			...OPTIONS,
			timeoutMs: 10,
		});
		expect(outcome.result.status).toBe("timeout");
		await Bun.sleep(80);
		expect(fake.closed).toBeGreaterThanOrEqual(1);
	});

	test("las peticiones del contexto pasan por el interceptor del paquete", async () => {
		const fake = fakeBrowser();
		await captureThumbnail(fake.browser, packageDir, OPTIONS);
		expect(fake.routeHandler).not.toBeNull();
	});
});

describe("packageRouteHandler (#470)", () => {
	function fakeRoute(url: string, method = "GET") {
		const calls: Array<[string, unknown]> = [];
		const route: RouteLike = {
			request: () => ({ url: () => url, method: () => method }),
			async fulfill(response) {
				calls.push(["fulfill", response]);
			},
			async abort(code) {
				calls.push(["abort", code]);
			},
		};
		return { route, calls };
	}

	test("sirve el paquete y aborta lo de fuera", async () => {
		const { realpath } = await import("node:fs/promises");
		const handler = packageRouteHandler(await realpath(packageDir), {
			maxAssetBytes: 1024,
		});

		const inside = fakeRoute(`${PACKAGE_ORIGIN}/index.html`);
		await handler(inside.route);
		expect(inside.calls[0]?.[0]).toBe("fulfill");
		const response = inside.calls[0]?.[1] as {
			status: number;
			body: Buffer;
		};
		expect(response.status).toBe(200);
		expect(Buffer.isBuffer(response.body)).toBe(true);

		const outside = fakeRoute("https://example.com/espia.js");
		await handler(outside.route);
		expect(outside.calls).toEqual([["abort", "blockedbyclient"]]);
	});

	test("si responder falla, aborta sin lanzar", async () => {
		const handler = packageRouteHandler(packageDir, { maxAssetBytes: 1024 });
		const calls: unknown[] = [];
		await handler({
			request: () => ({ url: () => `${PACKAGE_ORIGIN}/`, method: () => "GET" }),
			async fulfill() {
				throw new Error("route ya resuelta");
			},
			async abort(code) {
				calls.push(code);
			},
		});
		expect(calls).toEqual(["failed"]);
	});
});

describe("isEmptyCover", () => {
	test("vacía solo sin texto ni imágenes", () => {
		expect(isEmptyCover({ textLength: 0, mediaCount: 0 })).toBe(true);
		expect(isEmptyCover({ textLength: 1, mediaCount: 0 })).toBe(false);
		expect(isEmptyCover({ textLength: 0, mediaCount: 1 })).toBe(false);
	});
});
