import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import {
	AUTHOR_ASSET_CSP,
	CONTENT_ASSET_CSP,
	CONTENT_HTML_CSP,
	ELPX_HTML_CSP,
	elpxContentRoutes,
	readEmbedShimForTest,
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

describe("elpx-content CSP (audit H-1)", () => {
	test("HTML CSP keeps the content sandboxed without a same-origin escape", () => {
		expect(CONTENT_HTML_CSP).toContain(
			"sandbox allow-scripts allow-popups allow-forms",
		);
		// The escape token would let an author popup run at the platform origin.
		expect(CONTENT_HTML_CSP).not.toContain("allow-popups-to-escape-sandbox");
		expect(CONTENT_HTML_CSP).not.toContain("allow-same-origin");
		// #323 extracted ELPX_HTML_CSP on main; it must stay the hardened value.
		expect(ELPX_HTML_CSP).toBe(CONTENT_HTML_CSP);
	});

	test("non-HTML assets are served with an opaque-origin sandbox", () => {
		expect(CONTENT_ASSET_CSP).toBe(AUTHOR_ASSET_CSP);
		const directives = CONTENT_ASSET_CSP.split(";").map((d) => d.trim());
		// A top-level-navigated SVG/XML stays opaque -> its inline script cannot reach the platform.
		expect(directives).toContain("sandbox");
		expect(CONTENT_ASSET_CSP).not.toContain("allow-same-origin");
		expect(CONTENT_ASSET_CSP).not.toContain("allow-scripts");
	});
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

/**
 * El script que el API inyecta en cada HTML del .elpx es el LADO HIJO del bridge
 * compartido de eXeLearning, no una copia bespoke.
 *
 * Sin esto, el paquete se sirve con un runtime que no hace el handshake: el host
 * (que sí está migrado) nunca recibe `hello`, no promociona ningún embed y el
 * alumno ve recuadros negros permanentes donde debería haber vídeo. Es un fallo
 * silencioso — la página carga, no hay error en consola y no se reproduce nada —
 * así que la única forma de detectarlo es afirmar QUÉ bytes se sirven.
 */
describe("embed shim = artefacto canónico vendorizado", () => {
	test("los bytes servidos son los del child bundle vendorizado", async () => {
		const [served, vendored] = await Promise.all([
			readEmbedShimForTest(),
			Bun.file(
				new URL(
					"../../static/elpx/exe_external_media/exe-external-media-child.min.js",
					import.meta.url,
				),
			).text(),
		]);

		expect(served).toBe(vendored);
	});

	test("el script publica el contrato del bridge compartido", async () => {
		const served = await readEmbedShimForTest();

		// Los tres símbolos que el host y el iDevice de vídeo interactivo esperan.
		expect(served).toContain("exeExternalMediaChild");
		expect(served).toContain("exeEmbedShim");
		expect(served).toContain("exeMediaBridge");
		// Y la nota legal que ADR-0018 exige que sobreviva al minificado.
		expect(served).toContain("Dual-licensed");
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
