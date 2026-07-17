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
});

describe("buildEditorConfigScript — escape de XSS reflejado", () => {
	const editorBaseUrl = "/api/v1/exelearning-editor";

	test("no permite romper el <script> con un payload en elpxUrl/resourceId", () => {
		const payload = "</script><img src=x onerror=alert(1)>";
		const script = buildEditorConfigScript(payload, "</script>", editorBaseUrl);

		// El cierre legítimo del bloque <script> sigue presente...
		expect(script).toContain("</script>");
		// ...pero el payload del atacante NO debe aparecer crudo.
		expect(script).not.toContain("<img src=x onerror");
		expect(script).not.toContain("<img");
		// El cierre inyectado debe quedar escapado como unicode.
		expect(script).toContain("\\u003c/script\\u003e");
	});

	test("una URL normal sigue siendo un valor JSON parseable y utilizable", () => {
		const script = buildEditorConfigScript(
			"/recursos/proyecto.elpx",
			"abc-123",
			editorBaseUrl,
		);
		// Extrae el valor de initialProjectUrl y verifica que es JSON válido.
		const match = script.match(/initialProjectUrl: (.+),/);
		expect(match).not.toBeNull();
		const value = JSON.parse((match as RegExpMatchArray)[1]);
		expect(value).toBe("/recursos/proyecto.elpx");

		const idMatch = script.match(/resourceId: (.+),/);
		expect(idMatch).not.toBeNull();
		expect(JSON.parse((idMatch as RegExpMatchArray)[1])).toBe("abc-123");
	});

	test("sin elpxUrl produce initialProjectUrl: null", () => {
		const script = buildEditorConfigScript("", "", editorBaseUrl);
		expect(script).toContain("initialProjectUrl: null");
	});
});

describe("toInlineScriptJson", () => {
	test("escapa <, >, & y separadores de línea U+2028/U+2029", () => {
		const encoded = toInlineScriptJson("</script><a>&  ");
		expect(encoded).not.toContain("<");
		expect(encoded).not.toContain(">");
		expect(encoded).not.toContain("&");
		expect(encoded).not.toContain(" ");
		expect(encoded).not.toContain(" ");
		expect(encoded).toContain("\\u003c");
		expect(encoded).toContain("\\u003e");
		expect(encoded).toContain("\\u0026");
		expect(encoded).toContain("\\u2028");
		expect(encoded).toContain("\\u2029");
		// Sigue siendo JSON parseable hacia el valor original.
		expect(JSON.parse(encoded)).toBe("</script><a>&  ");
	});

	test("nullish se serializa como null", () => {
		expect(toInlineScriptJson(null)).toBe("null");
		expect(toInlineScriptJson(undefined)).toBe("null");
	});
});
