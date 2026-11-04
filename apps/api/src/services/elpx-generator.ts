import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sanitizeFilename } from "../uploads/config.ts";

export type GeneratorFileEntry = {
	filename: string;
	filePath: string;
};

// Nombres reservados que genera el propio paquete; un archivo subido con uno de
// estos nombres no debe poder sobrescribirlos dentro del .elpx.
const RESERVED_PACKAGE_FILENAMES = new Set(["content.xml", "index.html"]);

/**
 * Reduce un nombre de archivo (potencialmente controlado por el usuario y
 * persistido sin sanear) a un basename seguro para empaquetar: sin separadores
 * de ruta, sin secuencias de salto (..) y sin colisionar con los archivos que
 * genera el propio paquete. Defensa en profundidad frente a CAND-001: aunque la
 * validación de subida rechaza nombres peligrosos, los registros ya
 * persistidos en BD llegan aquí sin volver a validarse.
 */
function toSafeBundleName(filename: string): string {
	// Trata tanto "/" como "\\" como separadores antes de quedarnos con el basename.
	const base = path.basename(filename.replace(/\\/g, "/"));
	let safe = sanitizeFilename(base);
	// sanitizeFilename conserva los puntos, así que "." o ".." pueden sobrevivir.
	if (safe === "." || safe === ".." || safe.replace(/\./g, "") === "") {
		safe = "archivo";
	}
	if (RESERVED_PACKAGE_FILENAMES.has(safe.toLowerCase())) {
		const ext = path.extname(safe);
		const stem = path.basename(safe, ext) || "archivo";
		safe = `${stem}-adjunto${ext}`;
	}
	return safe;
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function generateId(): string {
	const now = new Date();
	const ts = [
		now.getUTCFullYear(),
		String(now.getUTCMonth() + 1).padStart(2, "0"),
		String(now.getUTCDate()).padStart(2, "0"),
		String(now.getUTCHours()).padStart(2, "0"),
		String(now.getUTCMinutes()).padStart(2, "0"),
		String(now.getUTCSeconds()).padStart(2, "0"),
	].join("");
	const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
	return `${ts}${rand}`;
}

function buildContentXml(
	title: string,
	author: string,
	language: string | undefined,
	license: string,
	files: GeneratorFileEntry[],
): string {
	const pageId = generateId();
	const blockId = generateId();
	const ideviceId = generateId();

	const linksHtml = files
		.map(
			(f) =>
				`<li><a href="${escapeHtml(f.filename)}">${escapeHtml(f.filename)}</a></li>`,
		)
		.join("");
	const listHtml = `<ul>${linksHtml}</ul>`;

	// JSON-encode the HTML for the jsonProperties CDATA block
	const textTextarea = JSON.stringify(listHtml);

	const htmlViewContent = `<div class="exe-text-template"><div class="textIdeviceContent"><div class="exe-text-activity"><div>${listHtml}</div></div></div></div>`;

	return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE ode SYSTEM "content.dtd">
<ode xmlns="http://www.intef.es/xsd/ode" version="2.0">
  <odeProperties>
    <odeProperty><key>pp_title</key><value>${escapeXml(title)}</value></odeProperty>
    <odeProperty><key>pp_description</key><value></value></odeProperty>
    <odeProperty><key>pp_author</key><value>${escapeXml(author)}</value></odeProperty>
    <odeProperty><key>license</key><value>${escapeXml(license)}</value></odeProperty>
    <odeProperty><key>lom_general_language</key><value>${escapeXml(language ?? "")}</value></odeProperty>
    <odeProperty><key>pp_learningResourceType</key><value></value></odeProperty>
  </odeProperties>
  <odeNavStructures>
    <odeNavStructure>
      <odePageId>${pageId}</odePageId>
      <odeParentPageId/>
      <pageName>${escapeXml(title)}</pageName>
      <odeNavStructureOrder>1</odeNavStructureOrder>
      <odeNavStructureProperties>
        <odeNavStructureProperty><key>titleNode</key><value>${escapeXml(title)}</value></odeNavStructureProperty>
        <odeNavStructureProperty><key>visibility</key><value>true</value></odeNavStructureProperty>
      </odeNavStructureProperties>
      <odePagStructures>
        <odePagStructure>
          <odePageId>${pageId}</odePageId>
          <odeBlockId>${blockId}</odeBlockId>
          <blockName>Texto</blockName>
          <iconName/>
          <odePagStructureOrder>1</odePagStructureOrder>
          <odePagStructureProperties>
            <odePagStructureProperty><key>visibility</key><value>true</value></odePagStructureProperty>
            <odePagStructureProperty><key>teacherOnly</key><value>false</value></odePagStructureProperty>
          </odePagStructureProperties>
          <odeComponents>
            <odeComponent>
              <odePageId>${pageId}</odePageId>
              <odeBlockId>${blockId}</odeBlockId>
              <odeIdeviceId>${ideviceId}</odeIdeviceId>
              <odeIdeviceTypeName>text</odeIdeviceTypeName>
              <htmlView><![CDATA[${htmlViewContent}]]></htmlView>
              <jsonProperties><![CDATA[{"ideviceId":${JSON.stringify(ideviceId)},"textInfoDurationInput":"","textInfoDurationTextInput":"Duración","textInfoParticipantsInput":"","textInfoParticipantsTextInput":"Agrupamiento","textTextarea":${textTextarea},"textFeedbackInput":"Show Feedback","textFeedbackTextarea":""}]]></jsonProperties>
              <odeComponentsOrder>1</odeComponentsOrder>
              <odeComponentsProperties>
                <odeComponentsProperty><key>visibility</key><value>true</value></odeComponentsProperty>
                <odeComponentsProperty><key>teacherOnly</key><value>false</value></odeComponentsProperty>
                <odeComponentsProperty><key>identifier</key><value/></odeComponentsProperty>
                <odeComponentsProperty><key>cssClass</key><value/></odeComponentsProperty>
              </odeComponentsProperties>
            </odeComponent>
          </odeComponents>
        </odePagStructure>
      </odePagStructures>
    </odeNavStructure>
  </odeNavStructures>
</ode>`;
}

function buildIndexHtml(title: string, files: GeneratorFileEntry[]): string {
	const links = files
		.map(
			(f) =>
				`    <li><a href="${escapeHtml(f.filename)}">${escapeHtml(f.filename)}</a></li>`,
		)
		.join("\n");

	return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    ul { line-height: 2; }
    a { color: #005fa3; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>Este recurso contiene los siguientes archivos:</p>
  <ul>
${links}
  </ul>
</body>
</html>`;
}

/**
 * Sanea cada nombre a un basename seguro (ver {@link toSafeBundleName}) y luego
 * garantiza unicidad añadiendo un sufijo numérico cuando hace falta.
 * Devuelve una nueva lista con nombres seguros y únicos.
 */
function sanitizeAndDeduplicateFilenames(
	files: GeneratorFileEntry[],
): GeneratorFileEntry[] {
	const seen = new Map<string, number>();
	return files.map((f) => {
		const safe = toSafeBundleName(f.filename);
		const lower = safe.toLowerCase();
		const count = seen.get(lower) ?? 0;
		seen.set(lower, count + 1);
		if (count === 0) return { ...f, filename: safe };
		const ext = path.extname(safe);
		const base = path.basename(safe, ext);
		return { ...f, filename: `${base}-${count}${ext}` };
	});
}

/**
 * Generates an .elpx ZIP package from a list of educational files.
 *
 * The resulting package:
 * - Contains a `content.xml` with minimal eXeLearning metadata (parseable by parseContentXml).
 * - Contains an `index.html` with relative links to all bundled files.
 * - Bundles all provided files in the ZIP root.
 * - Is compatible with processElpxUpload and the existing pipeline.
 *
 * @param opts.title      Resource title (used in metadata and index page)
 * @param opts.author     Resource author (optional)
 * @param opts.language   ISO 639-1 language code; sin él, lom_general_language
 *                        queda vacío en lugar de suponer «es» (#473)
 * @param opts.license    License identifier, defaults to "cc-by"
 * @param opts.files      List of files to bundle (each must have a local filePath)
 * @param opts.outputPath Absolute path where the resulting .elpx ZIP will be written
 */
export async function generateElpxFromFiles(opts: {
	title: string;
	author?: string;
	language?: string;
	license?: string;
	files: GeneratorFileEntry[];
	outputPath: string;
}): Promise<void> {
	const { title, author = "", language, license = "cc-by", outputPath } = opts;
	const files = sanitizeAndDeduplicateFilenames(opts.files);

	const workDir = path.join(
		os.tmpdir(),
		`procomun-gen-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await mkdir(workDir, { recursive: true });
	const resolvedWorkDir = path.resolve(workDir);

	try {
		// Write generated files to workdir
		await writeFile(
			path.join(workDir, "content.xml"),
			buildContentXml(title, author, language, license, files),
			"utf8",
		);
		await writeFile(
			path.join(workDir, "index.html"),
			buildIndexHtml(title, files),
			"utf8",
		);

		// Copy media files to workdir. Defensa en profundidad (CAND-001): además
		// de los nombres ya saneados, confirmamos que el destino resuelto queda
		// dentro del directorio de staging ANTES de copiar.
		for (const f of files) {
			const dest = path.resolve(workDir, f.filename);
			if (
				dest !== resolvedWorkDir &&
				!dest.startsWith(resolvedWorkDir + path.sep)
			) {
				throw new Error(
					`Nombre de archivo no permitido en el paquete: ${f.filename}`,
				);
			}
			await copyFile(f.filePath, dest);
		}

		// Build ZIP from the staging directory to avoid depending on the external `zip` binary.
		const allFiles = [
			"content.xml",
			"index.html",
			...files.map((f) => f.filename),
		];
		const proc = Bun.spawn(
			["python3", "-m", "zipfile", "-c", outputPath, ...allFiles],
			{ cwd: workDir, stdout: "ignore", stderr: "pipe" },
		);
		const exitCode = await proc.exited;
		if (exitCode !== 0) {
			const stderr = await new Response(proc.stderr).text();
			throw new Error(`Error al crear el paquete .elpx: ${stderr.trim()}`);
		}
	} finally {
		await rm(workDir, { recursive: true, force: true });
	}
}
