import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { seedPublishedElpxHash } from "../test-fixtures/published-elpx.ts";
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
	// Issue #466: la ruta pública solo sirve hashes de recursos publicados.
	await seedPublishedElpxHash(HASH, elpxDir);
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

/**
 * La fachada genérica (embed-facade.js) convive con el artefacto de eXe y NO
 * debe tocar lo que este ya trata: si el artefacto añade un proveedor y la
 * lista de exclusión no se actualiza, los dos se pisarían el mismo <iframe>.
 */
describe("fachada genérica: hosts excluidos = proveedores del artefacto", () => {
	test("excluye exactamente los hosts del registro del artefacto vendorizado", async () => {
		const [facade, child] = await Promise.all([
			Bun.file(
				new URL("../../static/elpx/embed-facade.js", import.meta.url),
			).text(),
			Bun.file(
				new URL(
					"../../static/elpx/exe_external_media/exe-external-media-child.min.js",
					import.meta.url,
				),
			).text(),
		]);
		const artifactHosts = [...child.matchAll(/hosts:\[([^\]]*)\]/g)]
			.flatMap((match) => match[1]?.match(/"([^"]+)"/g) ?? [])
			.map((quoted) => quoted.slice(1, -1));
		const block = facade.match(/ARTIFACT_HOSTS = \[([^\]]*)\]/)?.[1] ?? "";
		const facadeHosts = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);

		expect(artifactHosts.length).toBeGreaterThan(0);
		expect(new Set(facadeHosts)).toEqual(new Set(artifactHosts));
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

describe("HTML de Descartes y eXe (issue #406)", () => {
	test("deshace un nivel de entidades doblemente escapadas y reescribe background", async () => {
		const dir = path.join(process.env.UPLOAD_STORAGE_DIR ?? "", "elpx", HASH);
		await writeFile(
			path.join(dir, "indice.htm"),
			[
				"<html><head><title>&amp;Iacute;ndice</title></head><body",
				' background="img/fondo.png">',
				"<p>precio &amp; oferta</p>",
				"<p>&amp;lt;script&amp;gt;</p>",
				"</body></html>",
			].join(""),
			"utf8",
		);

		const res = await app.request(`/api/v1/elpx/${HASH}/indice.htm`);
		const body = await res.text();

		expect(res.status).toBe(200);
		expect(body).toContain("&Iacute;ndice");
		expect(body).not.toContain("&amp;Iacute;");
		expect(body).toContain("precio &amp; oferta");
		expect(body).toContain("&lt;script&gt;");
		expect(body).not.toContain("<script>alert");
		expect(body).toContain(`/api/v1/elpx/${HASH}/img/fondo.png`);
		expect(res.headers.get("content-security-policy")).not.toContain(
			"allow-same-origin",
		);
	});

	test("un archivo que no está en el paquete responde 404 con CORS", async () => {
		const res = await app.request(
			`/api/v1/elpx/${HASH}/no-esta-en-el-paquete.js`,
		);
		expect(res.status).toBe(404);
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
	});
});

// Un iDevice JSON de eXe (formulario de rellenar huecos, #431) guarda su
// contenido en data-idevice-json-data, escapado como atributo. El texto del
// autor lleva entidades propias, como el &quot; que TinyMCE pone en los style.
function ideviceJsonAttr(data: unknown): string {
	return JSON.stringify(data)
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function readIdeviceJson(html: string): unknown {
	const match = html.match(/data-idevice-json-data="([^"]*)"/);
	if (!match?.[1]) throw new Error("sin data-idevice-json-data");
	const value = match[1]
		.replace(/&quot;/g, '"')
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
	return JSON.parse(value);
}

describe("iDevice JSON de eXe (issue #431)", () => {
	const fill = (baseText: string) => ({
		eXeFormInstructions: "<p>Completa las palabras que faltan.</p>",
		questionsData: [{ activityType: "fill", baseText }],
	});

	async function serve(file: string, data: unknown): Promise<string> {
		const dir = path.join(process.env.UPLOAD_STORAGE_DIR ?? "", "elpx", HASH);
		await writeFile(
			path.join(dir, file),
			`<html><head><title>Autoevaluación</title></head><body><div id="idevice-1" class="idevice_node form" data-idevice-type="form" data-idevice-component-type="json" data-idevice-json-data="${ideviceJsonAttr(data)}"><p>Completa las palabras que faltan.</p></div></body></html>`,
			"utf8",
		);
		const res = await app.request(`/api/v1/elpx/${HASH}/${file}`);
		expect(res.status).toBe(200);
		return res.text();
	}

	test("conserva el &quot; de un style dentro de los datos del iDevice", async () => {
		const data = fill(
			'<p><span style="font-family: &quot;Open Sans&quot;">La <u>boca</u></span>&nbsp;: digestión.</p>',
		);
		const body = await serve("huecos-comillas.html", data);
		expect(readIdeviceJson(body)).toEqual(data);
	});

	test("no reescribe un url() dentro de los datos del iDevice", async () => {
		const data = fill(
			'<p><span style="background-image: url(&quot;../content/resources/fondo.png&quot;)">La <u>boca</u></span></p>',
		);
		const body = await serve("huecos-url.html", data);
		expect(readIdeviceJson(body)).toEqual(data);
	});

	test("reescribe un url() con &quot; de un style sin romper el atributo", async () => {
		const dir = path.join(process.env.UPLOAD_STORAGE_DIR ?? "", "elpx", HASH);
		await writeFile(
			path.join(dir, "fondo.html"),
			'<html><body><div id="caja" style="background-image: url(&quot;img/fondo.png&quot;)">Hola</div></body></html>',
			"utf8",
		);
		const res = await app.request(`/api/v1/elpx/${HASH}/fondo.html`);
		const body = await res.text();
		expect(body).toContain(
			`style="background-image: url(&quot;/api/v1/elpx/${HASH}/img/fondo.png&quot;)"`,
		);
	});
});

// Los .elpx del Procomún antiguo traen un HTML exportado sin los datos de sus
// iDevices JSON: el div del formulario no lleva data-idevice-json-data ni
// data-idevice-component-type, y eXe no lo monta. Los datos siguen en
// content.xml (jsonProperties), así que se recuperan de ahí al servir (#431).
describe("iDevice JSON de un .elpx legacy sin datos en el HTML (issue #431)", () => {
	const LEGACY_HASH = "fedcba9876543210fedcba9876543210fedcba98";
	const formData = {
		eXeFormInstructions: '<p>Lee el párrafo y completa "las palabras".</p>',
		questionsData: [
			{ activityType: "fill", baseText: "<p>La <u>boca</u> &amp; más</p>" },
		],
	};
	const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<ode><odeNavStructures><odeNavStructure><odePagStructures><odePagStructure><odeComponents>
<odeComponent><odeIdeviceId>idevice-form</odeIdeviceId><odeIdeviceTypeName>form</odeIdeviceTypeName>
<htmlView><![CDATA[<p>Lee el párrafo.</p>]]></htmlView>
<jsonProperties><![CDATA[${JSON.stringify(formData)}]]></jsonProperties></odeComponent>
<odeComponent><odeIdeviceId>idevice-video</odeIdeviceId><odeIdeviceTypeName>interactive-video</odeIdeviceTypeName>
<htmlView><![CDATA[<p>Vídeo</p>]]></htmlView>
<jsonProperties><![CDATA[{"slides":[]}]]></jsonProperties></odeComponent>
</odeComponents></odePagStructure></odePagStructures></odeNavStructure></odeNavStructures></ode>`;

	async function serveLegacy(body: string): Promise<string> {
		const dir = path.join(
			process.env.UPLOAD_STORAGE_DIR ?? "",
			"elpx",
			LEGACY_HASH,
		);
		await mkdir(path.join(dir, "html"), { recursive: true });
		await writeFile(path.join(dir, "content.xml"), contentXml, "utf8");
		await writeFile(
			path.join(dir, "html", "autoevaluacion.html"),
			`<html><head><title>Autoevaluación</title></head><body>${body}</body></html>`,
			"utf8",
		);
		const res = await app.request(
			`/api/v1/elpx/${LEGACY_HASH}/html/autoevaluacion.html`,
		);
		expect(res.status).toBe(200);
		return res.text();
	}

	test("recupera los datos del formulario desde content.xml", async () => {
		const body = await serveLegacy(
			'<div id="idevice-form" class="idevice_node form" data-idevice-path="../idevices/form/" data-idevice-type="form"><p>Lee el párrafo.</p></div>',
		);
		expect(body).toContain('data-idevice-component-type="json"');
		expect(body).toContain('data-idevice-template="form.html"');
		expect(readIdeviceJson(body)).toEqual(formData);
	});

	test("no toca un iDevice que ya trae sus datos", async () => {
		const own = { questionsData: [] };
		const body = await serveLegacy(
			`<div id="idevice-form" class="idevice_node form" data-idevice-type="form" data-idevice-component-type="json" data-idevice-json-data="${ideviceJsonAttr(own)}"></div>`,
		);
		expect(readIdeviceJson(body)).toEqual(own);
		expect(body.match(/data-idevice-component-type/g)).toHaveLength(1);
	});

	test("no convierte en JSON un iDevice que eXe exporta como HTML", async () => {
		const body = await serveLegacy(
			'<div id="idevice-video" class="idevice_node interactive-video" data-idevice-type="interactive-video"><p>Vídeo</p></div>',
		);
		expect(body).not.toContain("data-idevice-json-data");
	});
});
