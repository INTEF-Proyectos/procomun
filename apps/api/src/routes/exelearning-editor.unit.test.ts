import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
import {
	buildEditorConfigScript,
	exelearningEditorRoutes,
	toInlineScriptJson,
} from "./exelearning-editor.ts";

const app = new Hono();
app.route("/api/v1/exelearning-editor", exelearningEditorRoutes);

const editorDir = path.resolve(
	import.meta.dir,
	"../../static/exelearning-editor/static",
);
const editorAlreadyExists = existsSync(path.join(editorDir, "index.html"));
let createdMockDir = false;

// Create a minimal mock editor if not present (CI environment)
beforeAll(() => {
	if (!editorAlreadyExists) {
		mkdirSync(path.join(editorDir, "app"), { recursive: true });
		writeFileSync(
			path.join(editorDir, "index.html"),
			"<html><head></head><body>mock editor</body></html>",
		);
		writeFileSync(path.join(editorDir, "app", "app.bundle.js"), "// mock");
		writeFileSync(
			path.join(editorDir, "preview-sw.js"),
			"// mock preview service worker",
		);
		createdMockDir = true;
	}
});

afterAll(() => {
	if (createdMockDir) {
		rmSync(editorDir, { recursive: true, force: true });
	}
});

describe("GET /api/v1/exelearning-editor/index.html", () => {
	test("inyecta config de embedding", async () => {
		const res = await app.request(
			"/api/v1/exelearning-editor/index.html?elpxUrl=/test.elpx&resourceId=r1",
		);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("__EXE_EMBEDDING_CONFIG__");
		expect(html).toContain("/test.elpx");
		expect(html).toContain("r1");
		expect(html).toContain("<base");
		expect(html).toContain("__PROCOMUN_CONFIG__");
		expect(res.headers.get("content-type")).toContain("text/html");
		expect(res.headers.get("cache-control")).toBe("no-cache");
		expect(res.headers.get("content-security-policy")).toContain(
			"object-src 'none'",
		);
	});

	test("neutraliza el registro de Service Worker (protección interina)", async () => {
		const res = await app.request("/api/v1/exelearning-editor/index.html");
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("navigator.serviceWorker.register = function");
		expect(html).toContain(
			"navigator.serviceWorker.getRegistration = function",
		);
		expect(html).toContain(
			"navigator.serviceWorker.getRegistrations = function",
		);
		const swIdx = html.indexOf("navigator.serviceWorker.register");
		const bodyIdx = html.indexOf("<body");
		expect(swIdx).toBeGreaterThan(-1);
		expect(bodyIdx === -1 || swIdx < bodyIdx).toBe(true);
	});

	test("activa la previsualización opaca vía previewSnapshot", async () => {
		const res = await app.request("/api/v1/exelearning-editor/index.html");
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("previewSnapshot");
		expect(html).toContain('managementUrl: "/api/v1/preview-session"');
		expect(html).toContain('servingBaseUrl: "/api/v1/preview"');
		expect(html).toContain(
			'deleteUrlTemplate: "/api/v1/preview-session/{previewId}"',
		);
		// El protocolo v2 retirado no debe reaparecer: el editor actual no lo lee.
		expect(html).not.toContain("previewHttp");
		expect(html).not.toContain("protocolVersion");
	});

	test("inyecta bridge script con soporte de exportación", async () => {
		const res = await app.request("/api/v1/exelearning-editor/index.html");
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("WP_REQUEST_SAVE");
		expect(html).toContain("WP_REQUEST_EXPORT");
		expect(html).toContain("EXELEARNING_READY");
	});

	test("bridge script declara WP_REQUEST_EXPORT en capabilities", async () => {
		const res = await app.request("/api/v1/exelearning-editor/index.html");
		const html = await res.text();
		expect(html).toContain(
			"'WP_REQUEST_SAVE', 'WP_REQUEST_EXPORT', 'CONFIGURE'",
		);
	});

	test("bridge script valida formatos de exportación", async () => {
		const res = await app.request("/api/v1/exelearning-editor/index.html");
		const html = await res.text();
		expect(html).toContain("scorm12");
		expect(html).toContain("scorm2004");
		expect(html).toContain("epub3");
		expect(html).toContain("html5-sp");
		expect(html).toContain("WP_EXPORT_FILE");
	});

	test("sin elpxUrl pasa null como initialProjectUrl", async () => {
		const res = await app.request("/api/v1/exelearning-editor/index.html");
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("initialProjectUrl: null");
	});

	test("escapa elpxUrl y resourceId para impedir cerrar el script", async () => {
		const payload = "</script><img src=x onerror=alert(1)>";
		const query = new URLSearchParams({
			elpxUrl: payload,
			resourceId: payload,
		});
		const res = await app.request(
			`/api/v1/exelearning-editor/index.html?${query}`,
		);
		const html = await res.text();
		expect(res.status).toBe(200);
		expect(html).not.toContain("<img src=x onerror");
		expect(html).toContain("\\u003c/script\\u003e");
	});
});

describe("inline editor configuration encoding", () => {
	test("buildEditorConfigScript mantiene preview v2 y neutraliza payloads", () => {
		const payload = "</script><svg onload=alert(1)>";
		const script = buildEditorConfigScript(
			payload,
			payload,
			"/api/v1/exelearning-editor",
		);
		expect(script).toContain("previewSnapshot");
		expect(script).not.toContain("<svg onload");
		expect(script).toContain("\\u003c/script\\u003e");
	});

	test("toInlineScriptJson sigue siendo JSON reversible", () => {
		const value = "</script><a>&\u2028\u2029";
		const encoded = toInlineScriptJson(value);
		expect(encoded).not.toContain("<");
		expect(encoded).not.toContain(">");
		expect(encoded).not.toContain("&");
		expect(JSON.parse(encoded)).toBe(value);
	});
});

describe("GET /api/v1/exelearning-editor/* — static assets", () => {
	test("sirve archivo JS con MIME correcto", async () => {
		const res = await app.request(
			"/api/v1/exelearning-editor/app/app.bundle.js",
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/javascript");
		expect(res.headers.get("cache-control")).toContain("public");
	});

	test("devuelve 404 para path traversal", async () => {
		const res = await app.request(
			"/api/v1/exelearning-editor/../../../etc/passwd",
		);
		expect(res.status).toBe(404);
	});

	test("devuelve 404 para archivo inexistente", async () => {
		const res = await app.request("/api/v1/exelearning-editor/nonexistent.js");
		expect(res.status).toBe(404);
	});

	test("NO sirve preview-sw.js aunque exista (defensa en profundidad)", async () => {
		for (const p of ["preview-sw.js", "static/preview-sw.js"]) {
			const res = await app.request(`/api/v1/exelearning-editor/${p}`);
			expect(res.status, p).toBe(404);
		}
	});
});
