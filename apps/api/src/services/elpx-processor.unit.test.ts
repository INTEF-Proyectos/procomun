import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import {
	addCrossOriginToLocalScripts,
	elpxContentRoutes,
} from "../routes/elpx-content.ts";
import {
	buildElpxPath,
	parseElpxMetadata,
	processElpxUpload,
	removeElpxExtraction,
} from "./elpx-processor.ts";

// ---------------------------------------------------------------------------
// addCrossOriginToLocalScripts (ADR-0027)
// ---------------------------------------------------------------------------
describe("addCrossOriginToLocalScripts", () => {
	it("añade crossorigin a los scripts propios del paquete", () => {
		const html = `<script src="/api/v1/elpx/abc/libs/jquery.js"></script>`;
		const out = addCrossOriginToLocalScripts(html);
		expect(out).toContain(
			'<script src="/api/v1/elpx/abc/libs/jquery.js" crossorigin="anonymous">',
		);
	});

	it("no duplica crossorigin si ya existe", () => {
		const html = `<script src="/api/v1/elpx/abc/libs/jquery.js" crossorigin="use-credentials"></script>`;
		const out = addCrossOriginToLocalScripts(html);
		expect(out).toBe(html);
	});

	it("no toca scripts externos (cross-origin reales)", () => {
		const html = `<script src="https://cdn.example.com/x.js"></script>`;
		expect(addCrossOriginToLocalScripts(html)).toBe(html);
	});
});

// --- Helpers to create ZIP fixtures ---

const SAMPLE_CONTENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ode>
  <odeProperties>
    <odeProperty>
      <key>pp_title</key>
      <value>Recurso de prueba</value>
    </odeProperty>
    <odeProperty>
      <key>pp_description</key>
      <value>Descripcion del recurso educativo</value>
    </odeProperty>
    <odeProperty>
      <key>pp_author</key>
      <value>Maria Garcia</value>
    </odeProperty>
    <odeProperty>
      <key>license</key>
      <value>CC-BY-SA 4.0</value>
    </odeProperty>
    <odeProperty>
      <key>lom_general_language</key>
      <value>es</value>
    </odeProperty>
    <odeProperty>
      <key>pp_learningResourceType</key>
      <value>interactive</value>
    </odeProperty>
    <odeProperty>
      <key>some_other_key</key>
      <value>should be ignored</value>
    </odeProperty>
  </odeProperties>
</ode>`;

const PARTIAL_CONTENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ode>
  <odeProperties>
    <odeProperty>
      <key>pp_title</key>
      <value>Solo titulo</value>
    </odeProperty>
  </odeProperties>
</ode>`;

const SAMPLE_INDEX_HTML = `<!DOCTYPE html>
<html>
<head><link rel="stylesheet" href="css/style.css"></head>
<body>
<h1>Test</h1>
<img src="images/photo.png" alt="foto">
<a href="page2.html">Siguiente</a>
<a href="https://example.com">External</a>
</body>
</html>`;

const SAMPLE_CSS = `body { background: url("../images/bg.png"); }
.icon { background: url(icon.svg); }
.ext { background: url("https://cdn.example.com/bg.png"); }`;

let tempDir: string;
let validElpxPath: string;
let partialElpxPath: string;
let noContentXmlElpxPath: string;
let elpxWithIndexPath: string;
let extractedContentDir: string;
let fakeHash: string;
let fakeSha256Hash: string;

async function createZipFile(
	zipPath: string,
	files: Record<string, string>,
): Promise<void> {
	const staging = await mkdtemp(path.join(tmpdir(), "elpx-staging-"));
	const filePaths: string[] = [];

	for (const [name, content] of Object.entries(files)) {
		const fullPath = path.join(staging, name);
		await mkdir(path.dirname(fullPath), { recursive: true });
		await writeFile(fullPath, content, "utf-8");
		filePaths.push(name);
	}

	const proc = Bun.spawn(
		["python3", "-m", "zipfile", "-c", zipPath, ...filePaths],
		{
			cwd: staging,
			stdout: "ignore",
			stderr: "ignore",
		},
	);
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		throw new Error(`zipfile failed with exit code ${exitCode}`);
	}

	await rm(staging, { recursive: true, force: true });
}

beforeAll(async () => {
	tempDir = await mkdtemp(path.join(tmpdir(), "elpx-test-"));

	// 1) Valid .elpx with all 6 metadata fields
	validElpxPath = path.join(tempDir, "valid.elpx");
	await createZipFile(validElpxPath, {
		"content.xml": SAMPLE_CONTENT_XML,
		"index.html": SAMPLE_INDEX_HTML,
		"css/style.css": SAMPLE_CSS,
		"images/photo.png": "fake-png-data",
	});

	// 2) Partial metadata .elpx (only title)
	partialElpxPath = path.join(tempDir, "partial.elpx");
	await createZipFile(partialElpxPath, {
		"content.xml": PARTIAL_CONTENT_XML,
	});

	// 3) ZIP without content.xml
	noContentXmlElpxPath = path.join(tempDir, "no-content.elpx");
	await createZipFile(noContentXmlElpxPath, {
		"readme.txt": "This is not an elpx file",
	});

	// 4) .elpx with index.html for processElpxUpload
	elpxWithIndexPath = path.join(tempDir, "with-index.elpx");
	await createZipFile(elpxWithIndexPath, {
		"content.xml": SAMPLE_CONTENT_XML,
		"index.html": SAMPLE_INDEX_HTML,
		"css/style.css": SAMPLE_CSS,
		"images/photo.png": "fake-png-data",
	});

	// 5) Fake extracted content dir for elpx-content route tests
	fakeHash = "a".repeat(40);
	extractedContentDir = path.join(tempDir, "elpx", fakeHash);
	await mkdir(extractedContentDir, { recursive: true });
	await mkdir(path.join(extractedContentDir, "css"), { recursive: true });
	await mkdir(path.join(extractedContentDir, "images"), { recursive: true });
	await writeFile(
		path.join(extractedContentDir, "index.html"),
		SAMPLE_INDEX_HTML,
		"utf-8",
	);
	await writeFile(
		path.join(extractedContentDir, "css", "style.css"),
		SAMPLE_CSS,
		"utf-8",
	);
	await writeFile(
		path.join(extractedContentDir, "images", "photo.png"),
		"fake-png-bytes",
		"utf-8",
	);

	// 6) Directorio extraído con hash SHA-256 (64 chars): el importador legacy
	// Procomún usa el checksum del .elpx como hash para dedupe por contenido
	// (ADR-0029), a diferencia del UUID/SHA-1 (<=40 chars) del flujo normal.
	fakeSha256Hash = "b".repeat(64);
	const sha256ContentDir = path.join(tempDir, "elpx", fakeSha256Hash);
	await mkdir(sha256ContentDir, { recursive: true });
	await writeFile(
		path.join(sha256ContentDir, "index.html"),
		SAMPLE_INDEX_HTML,
		"utf-8",
	);
});

afterAll(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// parseElpxMetadata
// ---------------------------------------------------------------------------
describe("parseElpxMetadata", () => {
	it("extrae los 6 campos de metadatos correctamente", async () => {
		const metadata = await parseElpxMetadata(validElpxPath);

		expect(metadata.title).toBe("Recurso de prueba");
		expect(metadata.description).toBe("Descripcion del recurso educativo");
		expect(metadata.author).toBe("Maria Garcia");
		expect(metadata.license).toBe("CC-BY-SA 4.0");
		expect(metadata.language).toBe("es");
		expect(metadata.learningResourceType).toBe("interactive");
	});

	it("devuelve cadenas vacias para campos ausentes", async () => {
		const metadata = await parseElpxMetadata(partialElpxPath);

		expect(metadata.title).toBe("Solo titulo");
		expect(metadata.description).toBe("");
		expect(metadata.author).toBe("");
		expect(metadata.license).toBe("");
		expect(metadata.language).toBe("");
		expect(metadata.learningResourceType).toBe("");
	});

	it("lanza error si el archivo no existe", async () => {
		const bogusPath = path.join(tempDir, "no-existe.elpx");
		await expect(parseElpxMetadata(bogusPath)).rejects.toThrow(
			"El archivo no existe",
		);
	});

	it("lanza error si el ZIP no contiene content.xml", async () => {
		await expect(parseElpxMetadata(noContentXmlElpxPath)).rejects.toThrow(
			"no contiene content.xml",
		);
	});

	it("aplica los límites de extracción antes de leer content.xml", async () => {
		const zipBombPath = path.join(tempDir, "content-xml-bomb.elpx");
		await createZipFile(zipBombPath, {
			"content.xml": `<ode>${" ".repeat(4096)}</ode>`,
		});

		await expect(
			parseElpxMetadata(zipBombPath, {
				maxEntries: 10,
				maxTotalUncompressed: 1024,
				maxCompressionRatio: Number.MAX_SAFE_INTEGER,
			}),
		).rejects.toThrow(/tamaño máximo permitido/i);
	});
});

// ---------------------------------------------------------------------------
// buildElpxPath
// ---------------------------------------------------------------------------
describe("buildElpxPath", () => {
	it("devuelve la ruta correcta base/elpx/hash", () => {
		const result = buildElpxPath("/data/uploads", "abc123");
		expect(result).toBe(path.join("/data/uploads", "elpx", "abc123"));
	});

	it("funciona con rutas que terminan en separador", () => {
		const result = buildElpxPath("/data/uploads/", "def456");
		expect(result).toBe(path.join("/data/uploads/", "elpx", "def456"));
	});
});

// ---------------------------------------------------------------------------
// processElpxUpload
// ---------------------------------------------------------------------------
describe("processElpxUpload", () => {
	it("crea directorio de extraccion y detecta index.html", async () => {
		const baseDir = path.join(tempDir, "process-output-1");
		await mkdir(baseDir, { recursive: true });

		const result = await processElpxUpload(elpxWithIndexPath, baseDir);

		expect(typeof result.hash).toBe("string");
		expect(result.hash.length).toBeGreaterThan(0);
		expect(result.extractPath).toBe(path.join(baseDir, "elpx", result.hash));
		expect(result.hasPreview).toBe(true);
		expect(result.metadata.title).toBe("Recurso de prueba");
		expect(result.metadata.author).toBe("Maria Garcia");

		// Verify files were actually extracted
		const files = await readdir(result.extractPath);
		expect(files).toContain("index.html");
		expect(files).toContain("content.xml");
	});

	it("detecta hasPreview=false cuando no hay index.html", async () => {
		// Create .elpx without index.html
		const noIndexPath = path.join(tempDir, "no-index.elpx");
		await createZipFile(noIndexPath, {
			"content.xml": SAMPLE_CONTENT_XML,
			"data/notes.txt": "notas",
		});

		const baseDir = path.join(tempDir, "process-output-2");
		await mkdir(baseDir, { recursive: true });

		const result = await processElpxUpload(noIndexPath, baseDir);

		expect(result.hasPreview).toBe(false);
		expect(result.metadata.title).toBe("Recurso de prueba");
	});
});

// ---------------------------------------------------------------------------
// removeElpxExtraction
// ---------------------------------------------------------------------------
describe("removeElpxExtraction", () => {
	it("elimina el directorio de extraccion", async () => {
		const dirToRemove = path.join(tempDir, "to-remove");
		await mkdir(dirToRemove, { recursive: true });
		await writeFile(path.join(dirToRemove, "file.txt"), "content", "utf-8");

		await removeElpxExtraction(dirToRemove);

		const exists = await Bun.file(path.join(dirToRemove, "file.txt")).exists();
		expect(exists).toBe(false);
	});

	it("no lanza error si el directorio no existe", async () => {
		const nonExistent = path.join(tempDir, "does-not-exist-dir");
		// Should not throw
		await removeElpxExtraction(nonExistent);
	});
});

// ---------------------------------------------------------------------------
// elpxContentRoutes
// ---------------------------------------------------------------------------
describe("elpxContentRoutes", () => {
	let app: InstanceType<typeof Hono>;

	beforeAll(() => {
		// Point UPLOAD_STORAGE_DIR to our temp dir so elpx-content resolves files there
		process.env.UPLOAD_STORAGE_DIR = tempDir;

		app = new Hono();
		app.route("/api/v1/elpx", elpxContentRoutes);
	});

	it("GET /:hash devuelve index.html con URLs reescritas", async () => {
		const res = await app.request(`/api/v1/elpx/${fakeHash}`);

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("text/html");

		const html = await res.text();
		// Relative URLs should be rewritten to absolute paths
		expect(html).toContain(`/api/v1/elpx/${fakeHash}/css/style.css`);
		expect(html).toContain(`/api/v1/elpx/${fakeHash}/images/photo.png`);
		expect(html).toContain(`/api/v1/elpx/${fakeHash}/page2.html`);
		// External URLs should remain untouched
		expect(html).toContain('href="https://example.com"');
	});

	it("GET /:hash/css/style.css devuelve CSS con URLs reescritas", async () => {
		const res = await app.request(`/api/v1/elpx/${fakeHash}/css/style.css`);

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("text/css");

		const css = await res.text();
		// Relative url(../images/bg.png) from css/ dir should resolve to images/bg.png
		expect(css).toContain(`/api/v1/elpx/${fakeHash}/images/bg.png`);
		// url(icon.svg) in css/ dir should resolve to css/icon.svg
		expect(css).toContain(`/api/v1/elpx/${fakeHash}/css/icon.svg`);
		// External URLs should remain untouched
		expect(css).toContain("https://cdn.example.com/bg.png");
	});

	it("GET /:hash/images/photo.png devuelve binario con MIME correcto", async () => {
		const res = await app.request(`/api/v1/elpx/${fakeHash}/images/photo.png`);

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/png");
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
	});

	it("devuelve 404 para hash invalido (no hex, longitud incorrecta)", async () => {
		const res = await app.request("/api/v1/elpx/not-a-valid-hash");

		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error).toBeTruthy();
	});

	it("acepta un hash SHA-256 de 64 caracteres (importador legacy Procomún, ADR-0029)", async () => {
		const res = await app.request(`/api/v1/elpx/${fakeSha256Hash}`);

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("text/html");
	});

	it("devuelve 404 para hash valido pero sin contenido extraido", async () => {
		const missingHash = "b".repeat(40);
		const res = await app.request(`/api/v1/elpx/${missingHash}`);

		expect(res.status).toBe(404);
	});

	it("devuelve 404 para archivo inexistente dentro del hash", async () => {
		const res = await app.request(`/api/v1/elpx/${fakeHash}/no-existe.html`);

		expect(res.status).toBe(404);
	});

	it("devuelve 404 ante intento de path traversal con ../", async () => {
		const res = await app.request(
			`/api/v1/elpx/${fakeHash}/../../../etc/passwd`,
		);

		// The sanitizePath function should block ../ segments
		expect(res.status).toBe(404);
	});

	it("devuelve 404 ante path traversal codificado", async () => {
		const res = await app.request(
			`/api/v1/elpx/${fakeHash}/%2e%2e/%2e%2e/etc/passwd`,
		);

		expect(res.status).toBe(404);
	});

	it("establece cabeceras de seguridad en HTML", async () => {
		const res = await app.request(`/api/v1/elpx/${fakeHash}`);

		expect(res.status).toBe(200);
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(res.headers.get("Referrer-Policy")).toBe("same-origin");
		expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
	});

	it("aísla el contenido de autor con sandbox de origen opaco en la CSP", async () => {
		const res = await app.request(`/api/v1/elpx/${fakeHash}`);

		expect(res.status).toBe(200);
		const csp = res.headers.get("Content-Security-Policy") ?? "";
		// El contenido del .elpx debe servirse con origen opaco: directiva
		// sandbox presente y SIN allow-same-origin (ADR-0026, no hay SCORM que
		// exija puente same-origin).
		expect(csp).toContain("sandbox");
		expect(csp).toContain("allow-scripts");
		expect(csp).not.toContain("allow-same-origin");
	});

	it("inyecta el shim de embeds antes de </head> en el HTML (ADR-0027)", async () => {
		const res = await app.request(`/api/v1/elpx/${fakeHash}`);

		expect(res.status).toBe(200);
		const html = await res.text();
		// El shim se carga en modo CORS (crossorigin) para que el dev server de
		// Vite no bloquee el script clásico bajo origen opaco (ADR-0027).
		expect(html).toContain('src="/api/v1/elpx/embed-shim.js"');
		expect(html).toContain(
			'<script src="/api/v1/elpx/embed-shim.js" crossorigin="anonymous"></script>',
		);
		// Inyectado dentro del <head>, antes de cerrarlo.
		const shimIndex = html.indexOf("/api/v1/elpx/embed-shim.js");
		const headClose = html.indexOf("</head>");
		expect(shimIndex).toBeGreaterThan(-1);
		expect(headClose).toBeGreaterThan(-1);
		expect(shimIndex).toBeLessThan(headClose);
	});

	it("sirve el shim de embeds como JavaScript con CORS (ADR-0027)", async () => {
		const res = await app.request("/api/v1/elpx/embed-shim.js");

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("javascript");
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
		const js = await res.text();
		// El shim servido es ahora el canónico de mod_exelearning (exe_embed_shim.js):
		// expone window.exeEmbedShim y reporta embeds con el mensaje {type:'exe-embed'}.
		expect(js).toContain("exeEmbedShim");
		expect(js).toContain("exe-embed");
	});

	it("inyecta la fachada genérica DESPUÉS del artefacto de eXe, dentro del <head> (ADR-0033)", async () => {
		const res = await app.request(`/api/v1/elpx/${fakeHash}`);

		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain(
			'<script src="/api/v1/elpx/embed-facade.js" crossorigin="anonymous"></script>',
		);
		const shimIndex = html.indexOf("/api/v1/elpx/embed-shim.js");
		const facadeIndex = html.indexOf("/api/v1/elpx/embed-facade.js");
		const headClose = html.indexOf("</head>");
		expect(shimIndex).toBeGreaterThan(-1);
		expect(facadeIndex).toBeGreaterThan(shimIndex);
		expect(facadeIndex).toBeLessThan(headClose);
	});

	it("sirve la fachada genérica como JavaScript con CORS (ADR-0033)", async () => {
		const res = await app.request("/api/v1/elpx/embed-facade.js");

		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("javascript");
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(await res.text()).toContain("procomun-embed-facade");
	});

	it("sirve el contenido .elpx con CORS y crossorigin en scripts propios (ADR-0027)", async () => {
		const res = await app.request(`/api/v1/elpx/${fakeHash}`);

		expect(res.status).toBe(200);
		// El contenido del .elpx es embebible cross-origin y corre en origen
		// opaco: se sirve con ACAO y sus scripts propios en modo CORS.
		expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");

		// Un static (imagen) también lleva ACAO.
		const asset = await app.request(
			`/api/v1/elpx/${fakeHash}/images/photo.png`,
		);
		expect(asset.headers.get("Access-Control-Allow-Origin")).toBe("*");
	});

	it("establece cabecera Cache-Control en recursos estaticos", async () => {
		const res = await app.request(`/api/v1/elpx/${fakeHash}/images/photo.png`);

		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toContain("public");
	});
});
