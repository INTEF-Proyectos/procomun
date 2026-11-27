import { copyFile, cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_LICENSE } from "@procomun/db/validation";
import { sanitizeFilename } from "../uploads/config.ts";

export type GeneratorFileEntry = {
	filename: string;
	filePath: string;
};

// Nombres reservados que genera el propio paquete; un archivo subido con uno de
// estos nombres no debe poder sobrescribirlos dentro del .elpx.
const RESERVED_PACKAGE_FILENAMES = new Set([
	"content.xml",
	"index.html",
	"theme",
	"libs",
	"idevices",
	"content",
]);

export const DEFAULT_ELPX_THEME = "base";

/** Editor eXeLearning estático que se descarga en la imagen (Dockerfile). */
export const EXELEARNING_EDITOR_STATIC_DIR = path.resolve(
	import.meta.dir,
	"../../static/exelearning-editor/static",
);

const THEMES_DIR = "files/perm/themes/base";

// Ficheros comunes del export web de eXeLearning: destino en el paquete ←
// origen en el editor. Son los que enlaza el index.html de un export (#653).
const EXPORT_ASSETS: [string, string][] = [
	["libs/jquery/jquery.min.js", "libs/jquery/jquery.min.js"],
	["libs/bootstrap/bootstrap.min.css", "libs/bootstrap/bootstrap.min.css"],
	[
		"libs/bootstrap/bootstrap.bundle.min.js",
		"libs/bootstrap/bootstrap.bundle.min.js",
	],
	["libs/common.js", "app/common/common.js"],
	["libs/common_i18n.js", "app/common/common_i18n.js"],
	["libs/exe_export.js", "app/common/exe_export.js"],
	["libs/favicon.ico", "favicon.ico"],
	["content/css/base.css", "style/workarea/base.css"],
	["idevices/text", "files/perm/idevices/base/text/export"],
];

export type ElpxTheme = { name: string; title: string };

/** Estilos que trae el editor eXeLearning; vacío si no está descargado. */
export async function listElpxThemes(
	editorStaticDir = EXELEARNING_EDITOR_STATIC_DIR,
): Promise<ElpxTheme[]> {
	const dir = path.join(editorStaticDir, THEMES_DIR);
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	const themes: ElpxTheme[] = [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const config = Bun.file(path.join(dir, entry.name, "config.xml"));
		if (!(await config.exists())) continue;
		const title = (await config.text()).match(/<title>([^<]*)<\/title>/)?.[1];
		themes.push({ name: entry.name, title: title?.trim() || entry.name });
	}
	return themes.sort((a, b) =>
		a.name === DEFAULT_ELPX_THEME
			? -1
			: b.name === DEFAULT_ELPX_THEME
				? 1
				: a.title.localeCompare(b.title),
	);
}

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
	theme: string,
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
    <odeProperty><key>pp_theme</key><value>${escapeXml(theme)}</value></odeProperty>
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

/** index.html con la estructura del export web de eXeLearning (#653). */
function buildStyledIndexHtml(
	title: string,
	language: string | undefined,
	files: GeneratorFileEntry[],
): string {
	const links = files
		.map(
			(f) =>
				`<li><a href="${escapeHtml(f.filename)}">${escapeHtml(f.filename)}</a></li>`,
		)
		.join("\n");
	const safeTitle = escapeHtml(title);

	return `<!DOCTYPE html>
<html lang="${escapeHtml(language || "es")}" id="exe-index">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<link rel="icon" type="image/x-icon" href="libs/favicon.ico">
<script>document.querySelector("html").classList.add("js");</script>
<script src="libs/jquery/jquery.min.js"></script>
<script src="libs/common_i18n.js"></script>
<script src="libs/common.js"></script>
<script src="libs/exe_export.js"></script>
<script src="libs/bootstrap/bootstrap.bundle.min.js"></script>
<link rel="stylesheet" href="libs/bootstrap/bootstrap.min.css">
<script src="idevices/text/text.js"></script>
<link rel="stylesheet" href="idevices/text/text.css">
<link rel="stylesheet" href="content/css/base.css">
<script src="theme/style.js"></script>
<link rel="stylesheet" href="theme/style.css">
</head>
<body class="exe-export exe-web-site">
<script>document.body.className+=" js"</script>
<div class="exe-content exe-export pre-js siteNav-hidden">
<a href="#page-content-001" id="skipNav">Saltar al contenido</a>
<nav id="siteNav">
<ul>
<li class="active"><a href="index.html" class="active main-node no-ch">${safeTitle}</a></li>
</ul>
</nav>
<main id="page-content-001" class="page">
<header class="main-header">
<div class="page-header"><h1 class="page-title">${safeTitle}</h1></div>
</header>
<div id="page-content-page-content-001" class="page-content">
<article id="block-page-content-001" class="box no-header">
<div class="box-content">
<div id="idevice-page-content-001" class="idevice_node text" data-idevice-path="idevices/text/" data-idevice-type="text">
<ul>
${links}
</ul>
</div>
</div>
</article>
</div>
</main>
</div>
</body>
</html>`;
}

/**
 * Copia en el staging el estilo y los ficheros comunes del export. Devuelve
 * false si el editor no está descargado (CI, desarrollo sin `make up`).
 */
async function copyExportAssets(
	editorStaticDir: string,
	theme: string,
	workDir: string,
): Promise<boolean> {
	const themes = await listElpxThemes(editorStaticDir);
	if (themes.length === 0) return false;
	// Solo nombres que salen del propio listado: nada de rutas del cliente.
	if (!themes.some((t) => t.name === theme)) {
		throw new Error(`Estilo no disponible: ${theme}`);
	}
	await cp(
		path.join(editorStaticDir, THEMES_DIR, theme),
		path.join(workDir, "theme"),
		{ recursive: true },
	);
	for (const [dest, src] of EXPORT_ASSETS) {
		await cp(path.join(editorStaticDir, src), path.join(workDir, dest), {
			recursive: true,
		});
	}
	return true;
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
 * @param opts.license    License identifier, defaults to DEFAULT_LICENSE (#522)
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
	/** Estilo de eXeLearning (carpeta en el editor); por defecto «base». */
	theme?: string;
	editorStaticDir?: string;
}): Promise<void> {
	const {
		title,
		author = "",
		language,
		license = DEFAULT_LICENSE,
		outputPath,
		theme = DEFAULT_ELPX_THEME,
		editorStaticDir = EXELEARNING_EDITOR_STATIC_DIR,
	} = opts;
	const files = sanitizeAndDeduplicateFilenames(opts.files);

	const workDir = path.join(
		os.tmpdir(),
		`procomun-gen-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await mkdir(workDir, { recursive: true });
	const resolvedWorkDir = path.resolve(workDir);

	try {
		const styled = await copyExportAssets(editorStaticDir, theme, workDir);
		await writeFile(
			path.join(workDir, "content.xml"),
			buildContentXml(title, author, language, license, theme, files),
			"utf8",
		);
		await writeFile(
			path.join(workDir, "index.html"),
			styled
				? buildStyledIndexHtml(title, language, files)
				: buildIndexHtml(title, files),
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

		// `zip` viene en la imagen Docker (Dockerfile); python3 no (#649).
		const allFiles = [
			"content.xml",
			"index.html",
			...(styled ? ["theme", "libs", "idevices", "content"] : []),
			...files.map((f) => f.filename),
		];
		const proc = Bun.spawn(
			["zip", "-q", "-r", "-X", outputPath, "--", ...allFiles],
			{
				cwd: workDir,
				stdout: "ignore",
				stderr: "pipe",
			},
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
