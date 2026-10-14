import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import {
	AUTHOR_ASSET_CSP,
	ELPX_HTML_CSP,
	elpxContentRoutes,
	remainingPathAfter,
} from "./elpx-content.ts";

// Hash de 40 hex (estilo SHA-1) que satisface /^[a-f0-9-]{8,64}$/i.
const HASH = "0123456789abcdef0123456789abcdef01234567";
const SVG_BODY =
	'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';

const originalStorageDir = process.env.UPLOAD_STORAGE_DIR;
let tmpRoot = "";

const app = new Hono();
app.route("/api/v1/elpx", elpxContentRoutes);

function expectStrictAssetSandbox(csp: string | null) {
	expect(csp).not.toBeNull();
	// Valor canónico: sandbox sin tokens + default-src none.
	expect(csp).toBe(AUTHOR_ASSET_CSP);
	expect(csp).toContain("sandbox");
	// Sin allow-scripts/allow-same-origin: documento de origen opaco.
	expect(csp).not.toContain("allow-scripts");
	expect(csp).not.toContain("allow-same-origin");
}

beforeAll(async () => {
	// `getUploadConfig` lee UPLOAD_STORAGE_DIR en cada llamada, así que basta con
	// fijarlo antes de las peticiones.
	tmpRoot = await mkdtemp(path.join(tmpdir(), "elpx-content-test-"));
	process.env.UPLOAD_STORAGE_DIR = tmpRoot;

	const elpxDir = path.join(tmpRoot, "elpx", HASH);
	await mkdir(elpxDir, { recursive: true });
	await writeFile(path.join(elpxDir, "evil.svg"), SVG_BODY, "utf8");
	await writeFile(path.join(elpxDir, "styles.css"), "body{color:red}", "utf8");
	await writeFile(path.join(elpxDir, "data.bin"), "binario", "utf8");
	await writeFile(path.join(elpxDir, "sonido.mp3"), "mp3", "utf8");
	await writeFile(path.join(elpxDir, "sonido.ogg"), "ogg", "utf8");
	// XML también puede interpretarse como documento activo en algunos contextos.
	await writeFile(
		path.join(elpxDir, "payload.xml"),
		'<?xml version="1.0"?><x><script>alert(1)</script></x>',
		"utf8",
	);
});

afterAll(async () => {
	if (originalStorageDir === undefined) {
		delete process.env.UPLOAD_STORAGE_DIR;
	} else {
		process.env.UPLOAD_STORAGE_DIR = originalStorageDir;
	}
	if (tmpRoot) {
		await rm(tmpRoot, { recursive: true, force: true });
	}
});

describe("elpx-content CSP (XSS almacenado vía SVG)", () => {
	test("un .svg subido se sirve con CSP sandbox (origen opaco, sin scripts)", async () => {
		const res = await app.request(`/api/v1/elpx/${HASH}/evil.svg`);

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("image/svg+xml");
		expectStrictAssetSandbox(res.headers.get("content-security-policy"));
	});

	test("un .css subido se sirve con CSP sandbox", async () => {
		const res = await app.request(`/api/v1/elpx/${HASH}/styles.css`);

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/css");
		expectStrictAssetSandbox(res.headers.get("content-security-policy"));
	});

	test("un activo genérico se sirve con CSP sandbox", async () => {
		const res = await app.request(`/api/v1/elpx/${HASH}/data.bin`);

		expect(res.status).toBe(200);
		expectStrictAssetSandbox(res.headers.get("content-security-policy"));
		// No debe romperse el resto de cabeceras de servido de activos.
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
	});

	test("un .xml subido también recibe CSP sandbox (no solo SVG/CSS)", async () => {
		const res = await app.request(`/api/v1/elpx/${HASH}/payload.xml`);

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/xml");
		expectStrictAssetSandbox(res.headers.get("content-security-policy"));
	});
});

describe("audio anidado en el visor (issue #379)", () => {
	test("el HTML sigue en origen opaco pero un iframe del propio paquete puede montarse", () => {
		// El reproductor de eXeLearning va en un HTML hijo (`<audio controls>`
		// dentro de un iframe). El padre ya es origen opaco (sandbox sin
		// allow-same-origin): su origen es `null` y NO coincide con
		// `frame-ancestors 'self'`, así que el navegador descarta el hijo y
		// el audio no llega a cargar (botón de play inactivo, sin duración).
		// `frame-ancestors *` permite ese anidado sin devolver el origen real.
		expect(ELPX_HTML_CSP).toContain("sandbox");
		expect(ELPX_HTML_CSP).toContain("allow-scripts");
		expect(ELPX_HTML_CSP).not.toContain("allow-same-origin");
		expect(ELPX_HTML_CSP).toContain("frame-ancestors *");
		expect(ELPX_HTML_CSP).not.toContain("frame-ancestors 'self'");
		expect(ELPX_HTML_CSP).toContain("media-src");
	});

	test("mp3 y ogg se sirven con el tipo MIME de audio y CORS", async () => {
		const mp3 = await app.request(`/api/v1/elpx/${HASH}/sonido.mp3`);
		const ogg = await app.request(`/api/v1/elpx/${HASH}/sonido.ogg`);

		expect(mp3.status).toBe(200);
		expect(mp3.headers.get("content-type")).toBe("audio/mpeg");
		expect(ogg.status).toBe(200);
		expect(ogg.headers.get("content-type")).toBe("audio/ogg");
		expect(mp3.headers.get("access-control-allow-origin")).toBe("*");
		expect(ogg.headers.get("access-control-allow-origin")).toBe("*");
		// El aislamiento de activos no abre el origen del HTML.
		expectStrictAssetSandbox(mp3.headers.get("content-security-policy"));
		expect(mp3.headers.get("content-security-policy")).not.toContain(
			"allow-same-origin",
		);
	});
});

describe("remainingPathAfter", () => {
	test("resuelve index.html cuando el segmento es el último", () => {
		expect(remainingPathAfter(`/api/v1/elpx/${HASH}/`, HASH)).toBe(
			"index.html",
		);
		expect(
			remainingPathAfter(
				"/api/admin/resources/r1/versions/v1/preview/",
				"preview",
			),
		).toBe("index.html");
	});

	test("conserva la ruta relativa posterior al segmento", () => {
		expect(remainingPathAfter(`/api/v1/elpx/${HASH}/css/style.css`, HASH)).toBe(
			"css/style.css",
		);
		expect(
			remainingPathAfter(
				"/api/admin/resources/r1/versions/v1/preview/css/style.css",
				"preview",
			),
		).toBe("css/style.css");
	});
});
