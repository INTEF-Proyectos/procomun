import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateElpxFromFiles, listElpxThemes } from "./elpx-generator.ts";
import { parseElpxMetadata, processElpxUpload } from "./elpx-processor.ts";

const TEMP_DIR = path.join(os.tmpdir(), `procomun-gen-tests-${Date.now()}`);

afterAll(async () => {
	await rm(TEMP_DIR, { recursive: true, force: true });
});

async function makeTempFile(
	subdir: string,
	filename: string,
	content: string,
): Promise<string> {
	const dir = path.join(TEMP_DIR, subdir);
	await mkdir(dir, { recursive: true });
	const filePath = path.join(dir, filename);
	await writeFile(filePath, content, "utf8");
	return filePath;
}

describe("generateElpxFromFiles", () => {
	setDefaultTimeout(30_000);
	it("genera un .elpx válido con content.xml e index.html", async () => {
		const pdfPath = await makeTempFile(
			"test1",
			"documento.pdf",
			"%PDF-1.4 fake content",
		);
		const outputPath = path.join(TEMP_DIR, "test1-output.elpx");

		await generateElpxFromFiles({
			title: "Mi recurso de prueba",
			author: "Autor Test",
			language: "es",
			license: "cc-by",
			files: [{ filename: "documento.pdf", filePath: pdfPath }],
			outputPath,
		});

		const exists = await Bun.file(outputPath).exists();
		expect(exists).toBe(true);

		// Must be a valid ZIP (PK signature)
		const bytes = await Bun.file(outputPath).arrayBuffer();
		const view = new Uint8Array(bytes);
		expect(view[0]).toBe(0x50); // P
		expect(view[1]).toBe(0x4b); // K

		// ZIP must contain content.xml
		const text = Buffer.from(bytes).toString("latin1");
		expect(text).toContain("content.xml");
		expect(text).toContain("index.html");
		expect(text).toContain("documento.pdf");
	});

	it("el .elpx generado puede ser parseado por parseElpxMetadata", async () => {
		const filePath = await makeTempFile(
			"test2",
			"apuntes.txt",
			"contenido de apuntes",
		);
		const outputPath = path.join(TEMP_DIR, "test2-output.elpx");

		await generateElpxFromFiles({
			title: "Recurso con metadatos",
			author: "Docente",
			language: "es",
			license: "cc-by-sa",
			files: [{ filename: "apuntes.txt", filePath }],
			outputPath,
		});

		const metadata = await parseElpxMetadata(outputPath);
		expect(metadata.title).toBe("Recurso con metadatos");
		expect(metadata.author).toBe("Docente");
		expect(metadata.language).toBe("es");
		expect(metadata.license).toBe("cc-by-sa");
	});

	it("sin idioma no declara español en el paquete (#473)", async () => {
		const filePath = await makeTempFile("test-sin-idioma", "a.txt", "a");
		const outputPath = path.join(TEMP_DIR, "test-sin-idioma-output.elpx");

		await generateElpxFromFiles({
			title: "Recurso sin idioma",
			files: [{ filename: "a.txt", filePath }],
			outputPath,
		});

		const metadata = await parseElpxMetadata(outputPath);
		expect(metadata.title).toBe("Recurso sin idioma");
		expect(metadata.language).toBe("");
	});

	it("el .elpx generado pasa por processElpxUpload y tiene preview", async () => {
		const filePath = await makeTempFile("test3", "video.mp4", "fake-mp4-data");
		const outputPath = path.join(TEMP_DIR, "test3-output.elpx");
		const baseDir = path.join(TEMP_DIR, "test3-base");
		await mkdir(baseDir, { recursive: true });

		await generateElpxFromFiles({
			title: "Recurso con vídeo",
			files: [{ filename: "video.mp4", filePath }],
			outputPath,
		});

		const result = await processElpxUpload(outputPath, baseDir);
		expect(typeof result.hash).toBe("string");
		expect(result.hasPreview).toBe(true); // index.html is always generated

		const indexExists = await Bun.file(
			path.join(result.extractPath, "index.html"),
		).exists();
		expect(indexExists).toBe(true);

		const contentExists = await Bun.file(
			path.join(result.extractPath, "content.xml"),
		).exists();
		expect(contentExists).toBe(true);

		const videoExists = await Bun.file(
			path.join(result.extractPath, "video.mp4"),
		).exists();
		expect(videoExists).toBe(true);
	});

	it("el index.html contiene enlaces a todos los archivos", async () => {
		const pdf = await makeTempFile("test4", "doc.pdf", "pdf");
		const img = await makeTempFile("test4", "imagen.png", "png");
		const outputPath = path.join(TEMP_DIR, "test4-output.elpx");
		const baseDir = path.join(TEMP_DIR, "test4-base");
		await mkdir(baseDir, { recursive: true });

		await generateElpxFromFiles({
			title: "Recurso múltiple",
			files: [
				{ filename: "doc.pdf", filePath: pdf },
				{ filename: "imagen.png", filePath: img },
			],
			outputPath,
		});

		const result = await processElpxUpload(outputPath, baseDir);
		const indexHtml = await Bun.file(
			path.join(result.extractPath, "index.html"),
		).text();

		expect(indexHtml).toContain('href="doc.pdf"');
		expect(indexHtml).toContain('href="imagen.png"');
		expect(indexHtml).toContain("Recurso múltiple");
	});

	it("deduplica nombres de archivo repetidos", async () => {
		const file1 = await makeTempFile("test5/a", "archivo.pdf", "contenido a");
		const file2 = await makeTempFile("test5/b", "archivo.pdf", "contenido b");
		const outputPath = path.join(TEMP_DIR, "test5-output.elpx");

		await generateElpxFromFiles({
			title: "Duplicados",
			files: [
				{ filename: "archivo.pdf", filePath: file1 },
				{ filename: "archivo.pdf", filePath: file2 },
			],
			outputPath,
		});

		const bytes = await Bun.file(outputPath).arrayBuffer();
		const text = Buffer.from(bytes).toString("latin1");
		// Both should be present, one renamed
		expect(text).toContain("archivo.pdf");
		expect(text).toContain("archivo-1.pdf");
	});

	it("genera .elpx sin archivos adjuntos (solo metadatos)", async () => {
		const outputPath = path.join(TEMP_DIR, "test6-output.elpx");

		await generateElpxFromFiles({
			title: "Solo metadatos",
			files: [],
			outputPath,
		});

		const metadata = await parseElpxMetadata(outputPath);
		expect(metadata.title).toBe("Solo metadatos");
	});

	it("genera el paquete sin python3 en el PATH, como en la imagen Docker (#649)", async () => {
		// La imagen oven/bun no trae Python; solo `zip` (instalado en el Dockerfile).
		const zipBin = Bun.which("zip");
		if (!zipBin) throw new Error("zip no está instalado");
		const binDir = path.join(TEMP_DIR, "solo-zip-bin");
		await mkdir(binDir, { recursive: true });
		await symlink(zipBin, path.join(binDir, "zip"));
		const pdfPath = await makeTempFile("test649", "apuntes.pdf", "%PDF-1.4");
		const outputPath = path.join(TEMP_DIR, "test649-output.elpx");

		// Proceso hijo con un PATH donde solo existe `zip`: Bun no relee
		// process.env.PATH al lanzar procesos desde el mismo proceso.
		const generator = path.join(import.meta.dir, "elpx-generator.ts");
		const proc = Bun.spawn(
			[
				process.execPath,
				"-e",
				`const { generateElpxFromFiles } = await import(${JSON.stringify(generator)});
				await generateElpxFromFiles(${JSON.stringify({
					title: "Sin Python",
					files: [{ filename: "apuntes.pdf", filePath: pdfPath }],
					outputPath,
				})});`,
			],
			{ env: { PATH: binDir }, stdout: "ignore", stderr: "pipe" },
		);
		const stderr = await new Response(proc.stderr).text();
		expect({ exitCode: await proc.exited, stderr }).toEqual({
			exitCode: 0,
			stderr: "",
		});

		const metadata = await parseElpxMetadata(outputPath);
		expect(metadata.title).toBe("Sin Python");
	});

	it("neutraliza nombres con salto de ruta y no escribe fuera del staging (CAND-001)", async () => {
		const filePath = await makeTempFile("trav", "fuente.pdf", "datos");
		const outputPath = path.join(TEMP_DIR, "trav-output.elpx");
		const baseDir = path.join(TEMP_DIR, "trav-base");
		await mkdir(baseDir, { recursive: true });
		// Centinela en el directorio padre del staging; no debe crearse jamás.
		const sentinel = path.join(os.tmpdir(), "procomun-cand001-proof.txt");
		await rm(sentinel, { force: true });

		await generateElpxFromFiles({
			title: "Intento de traversal",
			files: [
				{ filename: "../procomun-cand001-proof.txt", filePath },
				{ filename: "/etc/evil.pdf", filePath },
				{ filename: "..\\..\\windows.pdf", filePath },
			],
			outputPath,
		});

		// No se escribió ningún archivo fuera del directorio de staging.
		expect(await Bun.file(sentinel).exists()).toBe(false);

		// El paquete contiene los archivos con nombres saneados (solo basename).
		const result = await processElpxUpload(outputPath, baseDir);
		expect(
			await Bun.file(
				path.join(result.extractPath, "procomun-cand001-proof.txt"),
			).exists(),
		).toBe(true);
		expect(
			await Bun.file(path.join(result.extractPath, "evil.pdf")).exists(),
		).toBe(true);
		expect(
			await Bun.file(path.join(result.extractPath, "windows.pdf")).exists(),
		).toBe(true);
	});

	it("evita que un archivo subido sobrescriba content.xml o index.html (CAND-001)", async () => {
		const evilXml = await makeTempFile(
			"collide",
			"evil-content",
			"<malicioso/>",
		);
		const evilHtml = await makeTempFile(
			"collide",
			"evil-index",
			"<h1>hijack</h1>",
		);
		const outputPath = path.join(TEMP_DIR, "collide-output.elpx");
		const baseDir = path.join(TEMP_DIR, "collide-base");
		await mkdir(baseDir, { recursive: true });

		await generateElpxFromFiles({
			title: "Recurso colisión",
			author: "Docente",
			files: [
				{ filename: "content.xml", filePath: evilXml },
				{ filename: "index.html", filePath: evilHtml },
			],
			outputPath,
		});

		// Los metadatos generados siguen intactos (no los pisó el archivo subido).
		const metadata = await parseElpxMetadata(outputPath);
		expect(metadata.title).toBe("Recurso colisión");
		expect(metadata.author).toBe("Docente");

		// El archivo subido se conserva bajo un nombre renombrado.
		const result = await processElpxUpload(outputPath, baseDir);
		expect(
			await Bun.file(
				path.join(result.extractPath, "content-adjunto.xml"),
			).exists(),
		).toBe(true);
		expect(
			await Bun.file(
				path.join(result.extractPath, "index-adjunto.html"),
			).exists(),
		).toBe(true);
	});

	it("los caracteres especiales en el título se escapan en el XML generado", async () => {
		const outputPath = path.join(TEMP_DIR, "test7-output.elpx");

		await generateElpxFromFiles({
			title: 'Título <especial> & "comillas"',
			files: [],
			outputPath,
		});

		// Extract content.xml from the ZIP and check XML is well-formed
		const tempExtract = path.join(TEMP_DIR, "test7-extract");
		await mkdir(tempExtract, { recursive: true });
		const proc = Bun.spawn(
			["unzip", "-o", "-q", outputPath, "content.xml", "-d", tempExtract],
			{
				stdout: "ignore",
				stderr: "ignore",
			},
		);
		await proc.exited;
		const xml = await Bun.file(path.join(tempExtract, "content.xml")).text();

		// The XML must use entity escaping for special characters
		expect(xml).toContain("&lt;especial&gt;");
		expect(xml).toContain("&amp;");
		expect(xml).toContain("&quot;");
		// Must not contain raw < or > inside the value (would break XML)
		expect(xml).not.toContain("<value>Título <");
	});
});

// Editor eXeLearning de mentira: solo los ficheros que copia el generador.
async function makeFakeEditor(name: string): Promise<string> {
	const dir = path.join(TEMP_DIR, name);
	const files: Record<string, string> = {
		"files/perm/themes/base/base/config.xml":
			"<theme><name>base</name><title>Default</title></theme>",
		"files/perm/themes/base/base/style.css": "/* estilo base */",
		"files/perm/themes/base/base/style.js": "",
		"files/perm/themes/base/neo/config.xml":
			"<theme><name>neo</name><title>Neo</title></theme>",
		"files/perm/themes/base/neo/style.css": "/* estilo neo */",
		"files/perm/themes/base/neo/style.js": "",
		"files/perm/themes/base/neo/icons/info.png": "png",
		"files/perm/idevices/base/text/export/text.css": "/* text */",
		"files/perm/idevices/base/text/export/text.js": "",
		"libs/jquery/jquery.min.js": "",
		"libs/bootstrap/bootstrap.min.css": "",
		"libs/bootstrap/bootstrap.bundle.min.js": "",
		"app/common/common.js": "",
		"app/common/common_i18n.js": "",
		"app/common/exe_export.js": "",
		"favicon.ico": "",
		"style/workarea/base.css": "/* base.css */",
	};
	for (const [rel, content] of Object.entries(files)) {
		await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
		await writeFile(path.join(dir, rel), content);
	}
	return dir;
}

async function zipEntries(zip: string): Promise<string[]> {
	const out = await new Response(
		Bun.spawn(["unzip", "-Z1", zip], { stdout: "pipe" }).stdout,
	).text();
	return out.split("\n").filter(Boolean);
}

async function zipText(zip: string, entry: string): Promise<string> {
	return new Response(
		Bun.spawn(["unzip", "-p", zip, entry], { stdout: "pipe" }).stdout,
	).text();
}

describe("estilos de eXeLearning en el paquete generado (#653)", () => {
	it("lista los estilos del editor con su título", async () => {
		const editor = await makeFakeEditor("editor-lista");
		expect(await listElpxThemes(editor)).toEqual([
			{ name: "base", title: "Default" },
			{ name: "neo", title: "Neo" },
		]);
	});

	it("sin editor no hay estilos que listar", async () => {
		expect(await listElpxThemes(path.join(TEMP_DIR, "no-existe"))).toEqual([]);
	});

	it("usa el estilo base por defecto, con la estructura del export de eXeLearning", async () => {
		const editorStaticDir = await makeFakeEditor("editor-base");
		const outputPath = path.join(TEMP_DIR, "estilo-base.elpx");

		await generateElpxFromFiles({
			title: "Con estilo",
			files: [],
			outputPath,
			editorStaticDir,
		});

		const entries = await zipEntries(outputPath);
		for (const entry of [
			"theme/style.css",
			"theme/config.xml",
			"libs/jquery/jquery.min.js",
			"libs/bootstrap/bootstrap.min.css",
			"libs/common.js",
			"libs/exe_export.js",
			"content/css/base.css",
			"idevices/text/text.css",
		]) {
			expect(entries).toContain(entry);
		}
		expect(await zipText(outputPath, "theme/style.css")).toBe(
			"/* estilo base */",
		);
		const html = await zipText(outputPath, "index.html");
		expect(html).toContain('href="theme/style.css"');
		expect(html).toContain('href="content/css/base.css"');
		expect(html).toContain('class="exe-export exe-web-site"');
		expect((await parseElpxMetadata(outputPath)).theme).toBe("base");
	});

	it("copia el estilo elegido y lo declara en content.xml", async () => {
		const editorStaticDir = await makeFakeEditor("editor-neo");
		const outputPath = path.join(TEMP_DIR, "estilo-neo.elpx");

		await generateElpxFromFiles({
			title: "Neo",
			files: [],
			outputPath,
			theme: "neo",
			editorStaticDir,
		});

		expect(await zipText(outputPath, "theme/style.css")).toBe(
			"/* estilo neo */",
		);
		expect(await zipEntries(outputPath)).toContain("theme/icons/info.png");
		expect((await parseElpxMetadata(outputPath)).theme).toBe("neo");
	});

	it("rechaza un estilo que no existe o con salto de ruta", async () => {
		const editorStaticDir = await makeFakeEditor("editor-malo");
		for (const theme of ["inventado", "../base", "neo/../../x"]) {
			await expect(
				generateElpxFromFiles({
					title: "x",
					files: [],
					outputPath: path.join(TEMP_DIR, "malo.elpx"),
					theme,
					editorStaticDir,
				}),
			).rejects.toThrow("Estilo no disponible");
		}
	});

	it("sin editor descargado genera el paquete sin estilo pero declara base", async () => {
		const outputPath = path.join(TEMP_DIR, "sin-editor.elpx");

		await generateElpxFromFiles({
			title: "Sin editor",
			files: [],
			outputPath,
			editorStaticDir: path.join(TEMP_DIR, "no-existe"),
		});

		expect(await zipEntries(outputPath)).not.toContain("theme/style.css");
		expect((await parseElpxMetadata(outputPath)).theme).toBe("base");
	});

	it("un adjunto llamado como una carpeta del paquete no la pisa", async () => {
		const editorStaticDir = await makeFakeEditor("editor-colision");
		const libs = await makeTempFile("colision", "libs", "adjunto");
		const outputPath = path.join(TEMP_DIR, "colision.elpx");

		await generateElpxFromFiles({
			title: "Colisión",
			files: [{ filename: "libs", filePath: libs }],
			outputPath,
			editorStaticDir,
		});

		const entries = await zipEntries(outputPath);
		expect(entries).toContain("libs/common.js");
		expect(entries).toContain("libs-adjunto");
	});
});
