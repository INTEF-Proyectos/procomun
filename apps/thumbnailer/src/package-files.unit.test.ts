import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	AUTHOR_ASSET_CSP,
	CAPTURE_HTML_CSP,
	decodeDoubleEscapedEntities,
	PACKAGE_ORIGIN,
	packageRelativePath,
	resolvePackageRequest,
} from "./package-files.ts";

const OPTIONS = { maxAssetBytes: 1024 };
let base: string;
let root: string;

beforeAll(async () => {
	base = await realpath(await mkdtemp(path.join(tmpdir(), "thumb-pkg-")));
	root = path.join(base, "elpx", "abc12345");
	await mkdir(path.join(root, "theme"), { recursive: true });
	await writeFile(
		path.join(root, "index.html"),
		"<!doctype html><title>Portada</title><h1>Hola</h1>",
	);
	await writeFile(
		path.join(root, "escapado.html"),
		"<title>&amp;Iacute;ndice &amp; m&aacute;s</title>",
	);
	await writeFile(path.join(root, "theme", "style.css"), "h1{color:red}");
	await writeFile(path.join(root, "grande.png"), new Uint8Array(2048));
	await writeFile(path.join(root, "video.mp4"), "x");
	// Fuera del paquete: otro paquete con prefijo común y un secreto.
	await mkdir(path.join(base, "elpx", "abc123456"), { recursive: true });
	await writeFile(path.join(base, "elpx", "abc123456", "index.html"), "otro");
	await writeFile(path.join(base, "secreto.txt"), "no");
	await symlink(path.join(base, "secreto.txt"), path.join(root, "enlace.txt"));
});

afterAll(async () => {
	if (base) await rm(base, { recursive: true, force: true });
});

const get = (pathname: string, method = "GET") =>
	resolvePackageRequest(
		root,
		{ url: `${PACKAGE_ORIGIN}${pathname}`, method },
		OPTIONS,
	);

describe("packageRelativePath", () => {
	test("normaliza la ruta y sale a index.html en la raíz", () => {
		expect(packageRelativePath("/")).toBe("index.html");
		expect(packageRelativePath("/./theme//style.css")).toBe("theme/style.css");
		expect(packageRelativePath("/html/p%C3%A1gina.html")).toBe(
			"html/página.html",
		);
	});

	test("rechaza las que intentan salir del paquete", () => {
		expect(packageRelativePath("/../secreto.txt")).toBeNull();
		expect(packageRelativePath("/theme/%2e%2e/%2e%2e/x")).toBeNull();
		expect(packageRelativePath("/a%5C..%5C..%5Cx")).toBeNull();
		expect(packageRelativePath("/a%00b")).toBeNull();
		expect(packageRelativePath("/%E0%A4%A")).toBeNull();
	});
});

describe("resolvePackageRequest (#470)", () => {
	test("sirve el HTML con la CSP de captura: origen opaco y sin ventanas", async () => {
		const response = await get("/index.html?nav=false");
		expect(response.action).toBe("fulfill");
		if (response.action !== "fulfill") return;
		expect(response.status).toBe(200);
		expect(response.headers["Content-Type"]).toBe("text/html");
		const csp = response.headers["Content-Security-Policy"];
		expect(csp).toBe(CAPTURE_HTML_CSP);
		expect(sandboxTokens(csp ?? "")).toContain("allow-scripts");
		expect(csp).not.toContain("allow-same-origin");
		// Adenda 2026-11-04 de ADR-0046: la captura no abre ventanas.
		expect(csp).not.toContain("allow-popups");
		expect(new TextDecoder().decode(response.body as Uint8Array)).toContain(
			"<h1>Hola</h1>",
		);
	});

	test("los demás ficheros llevan la CSP de activos y CORS abierto", async () => {
		const response = await get("/theme/style.css");
		if (response.action !== "fulfill") throw new Error("abortada");
		expect(response.headers["Content-Type"]).toBe("text/css");
		expect(response.headers["Content-Security-Policy"]).toBe(AUTHOR_ASSET_CSP);
		expect(response.headers["Access-Control-Allow-Origin"]).toBe("*");
		expect(response.headers["X-Content-Type-Options"]).toBe("nosniff");
	});

	test("corrige el doble escapado del título como la API", async () => {
		const response = await get("/escapado.html");
		if (response.action !== "fulfill") throw new Error("abortada");
		expect(response.body).toBe("<title>&Iacute;ndice &amp; m&aacute;s</title>");
	});

	test("aborta cualquier otro origen o esquema", async () => {
		for (const url of [
			"https://example.com/x.png",
			"http://elpx-thumb.invalid/index.html",
			"http://app:3000/api/v1/config",
			"data:text/html,hola",
			"no es una url",
		]) {
			expect(
				await resolvePackageRequest(root, { url, method: "GET" }, OPTIONS),
			).toMatchObject({ action: "abort" });
		}
	});

	test("solo GET y HEAD", async () => {
		expect(await get("/index.html", "POST")).toEqual({
			action: "abort",
			reason: "metodo",
		});
		expect((await get("/index.html", "HEAD")).action).toBe("fulfill");
	});

	test("no sale del paquete ni por .. ni por un enlace simbólico", async () => {
		for (const pathname of [
			"/../secreto.txt",
			"/%2e%2e/secreto.txt",
			"/enlace.txt",
			"/../abc123456/index.html",
			"/no-existe.html",
			"/theme",
		]) {
			const response = await get(pathname);
			expect(response).toMatchObject({ action: "fulfill", status: 404 });
		}
	});

	test("no lee multimedia ni ficheros por encima del límite", async () => {
		expect(await get("/video.mp4")).toEqual({
			action: "abort",
			reason: "multimedia",
		});
		expect(await get("/grande.png")).toEqual({
			action: "abort",
			reason: "demasiado-grande",
		});
	});
});

/** Directivas de una CSP, sin `sandbox`, indexadas por nombre. */
function directives(csp: string): Map<string, string> {
	const map = new Map<string, string>();
	for (const part of csp.split(";")) {
		const [name, ...values] = part.trim().split(/\s+/);
		if (name && name !== "sandbox") map.set(name, values.join(" "));
	}
	return map;
}

/** Permisos de la directiva `sandbox`; null si no la tiene. */
function sandboxTokens(csp: string): string[] | null {
	for (const part of csp.split(";")) {
		const [name, ...values] = part.trim().split(/\s+/);
		if (name === "sandbox") return values;
	}
	return null;
}

const POPUP_TOKENS = ["allow-popups", "allow-popups-to-escape-sandbox"];

// El contenido del autor corre en la miniatura con las mismas garantías que en
// el visor, y además sin ventanas emergentes (adenda 2026-11-04 de ADR-0046).
describe("paridad con routes/elpx-content.ts", () => {
	test("la CSP de captura es la del visor sin ventanas emergentes", async () => {
		const api = await import("../../api/src/routes/elpx-content.ts");
		// Garantías comunes: mismas directivas de recursos, red y formularios.
		expect(directives(CAPTURE_HTML_CSP)).toEqual(directives(api.ELPX_HTML_CSP));
		// Origen opaco en las dos.
		const viewer = sandboxTokens(api.ELPX_HTML_CSP);
		const capture = sandboxTokens(CAPTURE_HTML_CSP);
		expect(viewer).not.toBeNull();
		expect(capture).not.toBeNull();
		expect(viewer).not.toContain("allow-same-origin");
		expect(capture).not.toContain("allow-same-origin");
		// La captura solo quita permisos, nunca añade.
		for (const token of capture ?? []) expect(viewer).toContain(token);
		for (const token of POPUP_TOKENS) expect(capture).not.toContain(token);
		expect(capture?.sort()).toEqual(
			(viewer ?? []).filter((token) => !POPUP_TOKENS.includes(token)).sort(),
		);
	});

	test("misma CSP para los activos", async () => {
		const api = await import("../../api/src/routes/elpx-content.ts");
		expect(AUTHOR_ASSET_CSP).toBe(api.AUTHOR_ASSET_CSP);
	});

	test("mismo arreglo del doble escapado", async () => {
		const api = await import("../../api/src/routes/elpx-content.ts");
		for (const html of [
			"&amp;Iacute;",
			"&amp;#205;",
			"&amp;#xCD;",
			"&amp; suelto",
			"&amp;lt;b&amp;gt;",
		]) {
			expect(decodeDoubleEscapedEntities(html)).toBe(
				api.decodeDoubleEscapedEntities(html),
			);
		}
	});
});
