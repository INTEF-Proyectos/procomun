import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { generateElpxFromFiles } from "./elpx-generator.ts";
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
