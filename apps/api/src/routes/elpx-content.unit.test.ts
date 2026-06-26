import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { elpxContentRoutes } from "./elpx-content.ts";

// Hash de 40 hex (estilo SHA-1) que satisface /^[a-f0-9-]{8,40}$/i.
const HASH = "0123456789abcdef0123456789abcdef01234567";
const SVG_BODY =
	'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';

const originalStorageDir = process.env.UPLOAD_STORAGE_DIR;
let tmpRoot = "";

const app = new Hono();
app.route("/api/v1/elpx", elpxContentRoutes);

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
		const csp = res.headers.get("content-security-policy");
		expect(csp).not.toBeNull();
		expect(csp).toContain("sandbox");
		// `sandbox` sin allow-scripts/allow-same-origin: documento de origen opaco.
		expect(csp).not.toContain("allow-scripts");
		expect(csp).not.toContain("allow-same-origin");
	});

	test("un .css subido se sirve con CSP sandbox", async () => {
		const res = await app.request(`/api/v1/elpx/${HASH}/styles.css`);

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/css");
		const csp = res.headers.get("content-security-policy");
		expect(csp).not.toBeNull();
		expect(csp).toContain("sandbox");
	});

	test("un activo genérico se sirve con CSP sandbox", async () => {
		const res = await app.request(`/api/v1/elpx/${HASH}/data.bin`);

		expect(res.status).toBe(200);
		const csp = res.headers.get("content-security-policy");
		expect(csp).not.toBeNull();
		expect(csp).toContain("sandbox");
		// No debe romperse el resto de cabeceras de servido de activos.
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
	});
});
