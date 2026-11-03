/**
 * Captura con Chromium de verdad (#470, ADR-0046). Solo corre si hay un
 * navegador de Playwright instalado (`bunx playwright install chromium`); en
 * el CI de tests unitarios no lo hay y se salta.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	type BrowserHandle,
	chromiumLauncher,
	type Launcher,
} from "./browser.ts";
import { BrowserPool } from "./browser-pool.ts";
import {
	CONTEXT_OPTIONS,
	COVER_URL,
	captureThumbnail,
	packageRouteHandler,
} from "./capture.ts";

async function findLauncher(): Promise<Launcher | null> {
	for (const chromiumSandbox of [true, false]) {
		const launch = chromiumLauncher({ chromiumSandbox, chromiumPath: null });
		try {
			const browser = await launch();
			await browser.close();
			return launch;
		} catch {
			// Sin navegador instalado o sin sandbox posible en esta máquina.
		}
	}
	return null;
}

const launch = await findLauncher();

const OPTIONS = {
	timeoutMs: 10_000,
	settleMs: 200,
	maxImageBytes: 100 * 1024,
	maxAssetBytes: 5 * 1024 * 1024,
};

/** Ancho y alto de un JPEG leyendo su marcador SOF. */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
	let i = 2;
	while (i + 9 < bytes.length) {
		if (bytes[i] !== 0xff) return null;
		const marker = bytes[i + 1] ?? 0;
		const length = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
		const isFrame =
			marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
		if (isFrame) {
			return {
				height: ((bytes[i + 5] ?? 0) << 8) | (bytes[i + 6] ?? 0),
				width: ((bytes[i + 7] ?? 0) << 8) | (bytes[i + 8] ?? 0),
			};
		}
		i += 2 + length;
	}
	return null;
}

const EXE_CHROME = `
<nav id="siteNav"><ul><li><a href="index.html">MENU DE EXE</a></li></ul></nav>
<div class="nav-buttons"><a href="html/2.html">Siguiente</a></div>
<footer id="siteFooter"><div id="packageLicense">Licencia CC BY-SA</div></footer>
<p id="made-with-eXe"><a href="https://exelearning.net/">Creado con eXeLearning</a></p>`;

describe.skipIf(!launch)("captura con Chromium (#470)", () => {
	let base: string;
	let browser: BrowserHandle;
	let canaryHits: string[];
	let canary: ReturnType<typeof Bun.serve>;

	async function writePackage(hash: string, html: string) {
		const dir = path.join(base, "elpx", hash);
		await mkdir(dir, { recursive: true });
		await writeFile(path.join(dir, "index.html"), html);
		return dir;
	}

	beforeAll(async () => {
		base = await realpath(await mkdtemp(path.join(tmpdir(), "thumb-real-")));
		canaryHits = [];
		canary = Bun.serve({
			port: 0,
			hostname: "127.0.0.1",
			fetch(request) {
				canaryHits.push(new URL(request.url).pathname);
				return new Response("filtrado");
			},
		});
		browser = await (launch as Launcher)();
	}, 60_000);

	afterAll(async () => {
		await browser?.close();
		canary?.stop(true);
		if (base) await rm(base, { recursive: true, force: true });
	});

	test("captura la portada en JPEG de 640×400", async () => {
		const dir = await writePackage(
			"aaaa0001",
			`<!doctype html><html><head><meta charset="utf-8">
			<link rel="stylesheet" href="theme/style.css"></head>
			<body class="exe-export exe-web-site">${EXE_CHROME}
			<main class="page"><h1>Vender con los sentidos</h1>
			<svg width="300" height="120"><rect width="300" height="120" fill="#c33"/></svg>
			<p>Recurso educativo abierto.</p></main></body></html>`,
		);
		await mkdir(path.join(dir, "theme"), { recursive: true });
		await writeFile(path.join(dir, "theme", "style.css"), "h1{color:#063}");

		const { result } = await captureThumbnail(browser, dir, OPTIONS);

		expect(result.status).toBe("ok");
		if (result.status !== "ok") return;
		expect(Array.from(result.bytes.subarray(0, 3))).toEqual([0xff, 0xd8, 0xff]);
		expect(jpegSize(result.bytes)).toEqual({ width: 640, height: 400 });
		expect(result.bytes.byteLength).toBeLessThanOrEqual(100 * 1024);
	}, 30_000);

	test("la navegación de eXe no cuenta como contenido: sin nada más, empty", async () => {
		const dir = await writePackage(
			"bbbb0002",
			`<!doctype html><body class="exe-web-site">${EXE_CHROME}<main class="page"></main></body>`,
		);
		const { result } = await captureThumbnail(browser, dir, OPTIONS);
		expect(result).toEqual({ status: "empty" });
	}, 30_000);

	test("el contenido corre en origen opaco y no sale ninguna petición", async () => {
		const target = `http://127.0.0.1:${canary.port}`;
		const dir = await writePackage(
			"cccc0003",
			`<!doctype html><html><head>
			<script src="${target}/script.js"></script>
			<link rel="stylesheet" href="${target}/style.css">
			<link rel="prefetch" href="${target}/prefetch">
			</head><body><h1 id="estado">cargando</h1>
			<img src="${target}/img.png" alt="">
			<iframe src="${target}/iframe"></iframe>
			<script>
				const out = [];
				out.push("origin=" + self.origin);
				try { out.push("cookie=" + document.cookie); } catch (e) { out.push("cookie=bloqueada"); }
				try { localStorage.setItem("x", "1"); out.push("storage=si"); } catch (e) { out.push("storage=bloqueado"); }
				fetch("${target}/fetch").catch(() => {});
				fetch("https://example.com/fuera").catch(() => {});
				new Image().src = "${target}/beacon.png";
				try { navigator.sendBeacon("${target}/sendbeacon", "x"); } catch (e) {}
				try { new WebSocket("ws://127.0.0.1:${canary.port}/ws"); } catch (e) {}
				try { window.open("${target}/popup"); } catch (e) {}
				document.getElementById("estado").textContent = out.join(" ");
			</script></body></html>`,
		);

		// Misma configuración que captureThumbnail, pero leyendo la página.
		const context = await browser.newContext(CONTEXT_OPTIONS);
		try {
			await context.route("**/*", packageRouteHandler(dir, OPTIONS));
			const page = await context.newPage();
			await page.goto(COVER_URL, { waitUntil: "load", timeout: 10_000 });
			await page.waitForTimeout(500);
			expect(
				await page.evaluate('document.getElementById("estado").textContent'),
			).toBe("origin=null cookie=bloqueada storage=bloqueado");
		} finally {
			await context.close();
		}

		const { result } = await captureThumbnail(browser, dir, OPTIONS);
		expect(result.status).toBe("ok");
		await Bun.sleep(300);
		expect(canaryHits).toEqual([]);
	}, 40_000);

	test("una portada que se va a otra web no deja capturar la página de error", async () => {
		const dir = await writePackage(
			"ffff0006",
			'<!doctype html><h1>Adiós</h1><script>location.href = "https://example.com/";</script>',
		);
		const { result } = await captureThumbnail(browser, dir, OPTIONS);
		expect(result.status).not.toBe("ok");
	}, 30_000);

	test("un bucle infinito se corta por tiempo y el navegador se relanza", async () => {
		const loop = await writePackage(
			"dddd0004",
			"<!doctype html><h1>Bucle</h1><script>for(;;){}</script>",
		);
		const good = await writePackage("eeee0005", "<!doctype html><h1>Bien</h1>");
		const pool = new BrowserPool(launch as Launcher, { recycleAfter: 50 });
		try {
			const started = Date.now();
			const stuck = await pool.run((b) =>
				captureThumbnail(b, loop, { ...OPTIONS, timeoutMs: 2_000 }),
			);
			expect(stuck.result.status).toBe("timeout");
			expect(stuck.browserSuspect).toBe(true);
			expect(Date.now() - started).toBeLessThan(15_000);

			const after = await pool.run((b) => captureThumbnail(b, good, OPTIONS));
			expect(after.result.status).toBe("ok");
			expect(pool.launches).toBe(2);
		} finally {
			await pool.close();
		}
	}, 60_000);
});
