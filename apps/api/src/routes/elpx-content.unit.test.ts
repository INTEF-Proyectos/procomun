import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import {
	AUTHOR_ASSET_CSP,
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

describe("presentaciones eXeLearning (issue #391)", () => {
	test("reescribe iframes y scripts de localhost al HTML empaquetado y permite enmarcarlos", async () => {
		const storage = process.env.UPLOAD_STORAGE_DIR;
		if (!storage) throw new Error("UPLOAD_STORAGE_DIR no fijado");
		const elpxDir = path.join(storage, "elpx", HASH);
		await mkdir(path.join(elpxDir, "html"), { recursive: true });
		await mkdir(path.join(elpxDir, "content", "resources"), {
			recursive: true,
		});
		await mkdir(path.join(elpxDir, "libs"), { recursive: true });
		await writeFile(
			path.join(elpxDir, "content", "resources", "pagina.html"),
			"<!doctype html><title>Tema y justificación</title><p>Contenido de la diapositiva</p>",
			"utf8",
		);
		await writeFile(
			path.join(elpxDir, "content", "resources", "relativa.html"),
			"<!doctype html><p>relativa</p>",
			"utf8",
		);
		await writeFile(
			path.join(elpxDir, "libs", "common.js"),
			"/* paquete */",
			"utf8",
		);
		await writeFile(
			path.join(elpxDir, "html", "diapositiva.html"),
			`<!doctype html><head></head><body>
<iframe src="http://localhost:8080/content/resources/pagina.html" style="width:100%;height:85vh;border:none;"></iframe>
<iframe src="http://127.0.0.1:51235/content/resources/pagina.html"></iframe>
<iframe src="{{context_path}}/content/resources/pagina.html"></iframe>
<iframe src="../content/resources/relativa.html"></iframe>
<iframe src="http://localhost:9/"></iframe>
<iframe src="http://localhost:8080/../../etc/passwd"></iframe>
<script src="http://localhost:8080/libs/common.js"></script>
<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>
<a href="https://example.com/externo">externo</a>
</body>`,
			"utf8",
		);

		const res = await app.request(`/api/v1/elpx/${HASH}/html/diapositiva.html`);
		expect(res.status).toBe(200);
		const html = await res.text();
		const base = `/api/v1/elpx/${HASH}/`;

		// El editor eXe deja el iframe contra localhost o {{context_path}}.
		// En el visor tiene que apuntar al HTML que ya viaja en el paquete.
		expect(html).not.toMatch(/https?:\/\/(localhost|127\.0\.0\.1)\b/i);
		expect(html).not.toContain("{{context_path}}");
		expect(html).not.toContain("etc/passwd");
		expect(html).toContain(`src="${base}content/resources/pagina.html"`);
		expect(html).toContain(`src="${base}content/resources/relativa.html"`);
		expect(html).toContain(`src="${base}libs/common.js"`);
		expect(html).toContain('src="https://www.youtube.com/embed/dQw4w9WgXcQ"');
		expect(html).toContain('href="https://example.com/externo"');

		const parentCsp = res.headers.get("content-security-policy") ?? "";
		expect(parentCsp).toContain("sandbox");
		expect(parentCsp).not.toContain("allow-same-origin");
		expect(parentCsp).not.toContain("allow-top-navigation");

		// El hijo es otro HTML del paquete. El padre ya es origen opaco: con
		// frame-ancestors 'self' Chrome lo descarta y pinta «localhost rechazó
		// la conexión» en cada diapositiva.
		const child = await app.request(
			`/api/v1/elpx/${HASH}/content/resources/pagina.html`,
		);
		expect(child.status).toBe(200);
		const childCsp = child.headers.get("content-security-policy") ?? "";
		expect(childCsp).toContain("frame-ancestors *");
		expect(childCsp).not.toContain("frame-ancestors 'self'");
		expect(childCsp).toContain("sandbox");
		expect(childCsp).not.toContain("allow-same-origin");
		expect(childCsp).not.toContain("allow-top-navigation");
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
