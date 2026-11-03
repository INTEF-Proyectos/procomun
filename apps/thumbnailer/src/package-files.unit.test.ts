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
	decodeDoubleEscapedEntities,
	ELPX_HTML_CSP,
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
	test("sirve el HTML con la CSP de origen opaco", async () => {
		const response = await get("/index.html?nav=false");
		expect(response.action).toBe("fulfill");
		if (response.action !== "fulfill") return;
		expect(response.status).toBe(200);
		expect(response.headers["Content-Type"]).toBe("text/html");
		expect(response.headers["Content-Security-Policy"]).toBe(ELPX_HTML_CSP);
		expect(response.headers["Content-Security-Policy"]).toContain(
			"sandbox allow-scripts",
		);
		expect(response.headers["Content-Security-Policy"]).not.toContain(
			"allow-same-origin",
		);
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

// Las copias de la API no pueden divergir: el contenido del autor tiene que
// correr con la misma política en la miniatura y en el visor.
describe("paridad con routes/elpx-content.ts", () => {
	test("misma CSP para HTML y para activos", async () => {
		const api = await import("../../api/src/routes/elpx-content.ts");
		expect(ELPX_HTML_CSP).toBe(api.ELPX_HTML_CSP);
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
