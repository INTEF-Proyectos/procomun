/**
 * CLI: rellena elpx_projects.has_screenshot en los paquetes subidos antes de
 * #409, mirando si tienen screenshot.png en la raíz de su extracción.
 * Uso: bun run apps/cli/src/index.ts elpx:screenshots [--dry-run]
 */

/**
 * Qué se ha podido averiguar de la extracción de un paquete (revisión de #471).
 * Hay que distinguir «no la encuentro» de «no la tiene»: si `UPLOAD_STORAGE_DIR`
 * es relativo (admitido en ADR-0011), la ruta que guardó la API ejecutándose
 * desde `apps/api` apunta a otro sitio al lanzar el CLI desde la raíz. Tratar
 * eso como «no tiene captura» persistía `has_screenshot = false` sobre una
 * imagen que sigue en disco, y la tarjeta dejaba de usarla.
 */
export type ExtractionState = "screenshot" | "no-screenshot" | "unreachable";

export interface ElpxScreenshotDeps {
	listProjects: () => Promise<
		Array<{
			id: string;
			hash: string;
			extractPath: string;
			hasScreenshot: boolean;
		}>
	>;
	setHasScreenshot: (id: string, hasScreenshot: boolean) => Promise<void>;
	inspectExtraction: (project: {
		hash: string;
		extractPath: string;
	}) => Promise<ExtractionState>;
}

export interface ElpxScreenshotReport {
	checked: number;
	withScreenshot: number;
	changed: number;
	/** Extracciones que no se han podido localizar: no se toca su estado. */
	unreachable: number;
	dryRun: boolean;
}

/**
 * Directorio real de la extracción de un paquete, o `null` si no aparece
 * (revisión de #471). Se prueban, en este orden:
 *
 * 1. la ruta guardada, que es la buena cuando es absoluta o cuando el CLI se
 *    ejecuta desde el mismo directorio que la API;
 * 2. `<almacén>/elpx/<hash>`, que es como la construye `buildElpxPath`: así se
 *    recupera el caso de `UPLOAD_STORAGE_DIR` relativo guardado desde
 *    `apps/api` y leído desde la raíz del repositorio.
 *
 * Devolver `null` es lo que impide persistir `false` sobre una captura que
 * sigue en disco.
 */
export async function resolveExtractionDir(
	extractPath: string,
	hash: string,
	storageDir: string,
): Promise<string | null> {
	const { stat } = await import("node:fs/promises");
	const { join, resolve } = await import("node:path");

	const candidates = [
		resolve(extractPath),
		resolve(join(storageDir, "elpx", hash)),
	];
	for (const candidate of candidates) {
		try {
			if ((await stat(candidate)).isDirectory()) return candidate;
		} catch {
			// Siguiente candidato.
		}
	}
	return null;
}

export function parseElpxScreenshotArgs(args: string[]): { dryRun: boolean } {
	let dryRun = false;
	for (const arg of args) {
		if (arg === "--dry-run") dryRun = true;
		else throw new Error(`Argumento desconocido: ${arg}`);
	}
	return { dryRun };
}

export async function runElpxScreenshotBackfill(
	options: { dryRun: boolean },
	deps: ElpxScreenshotDeps,
): Promise<ElpxScreenshotReport> {
	const report: ElpxScreenshotReport = {
		checked: 0,
		withScreenshot: 0,
		changed: 0,
		unreachable: 0,
		dryRun: options.dryRun,
	};
	for (const project of await deps.listProjects()) {
		report.checked++;
		const state = await deps.inspectExtraction(project);
		// Sin localizar la extracción no se sabe nada: se avisa y se deja el
		// estado como está, en vez de dar por buena la ausencia (revisión #471).
		if (state === "unreachable") {
			report.unreachable++;
			console.warn(
				`[elpx:screenshots] ${project.hash}: no se encuentra la extracción (${project.extractPath}); se deja has_screenshot=${project.hasScreenshot}. Revisa UPLOAD_STORAGE_DIR y desde dónde se ejecuta.`,
			);
			continue;
		}
		const found = state === "screenshot";
		if (found) report.withScreenshot++;
		if (found === project.hasScreenshot) continue;
		report.changed++;
		if (!options.dryRun) await deps.setHasScreenshot(project.id, found);
	}
	return report;
}

export async function elpxScreenshots(args: string[]) {
	const options = parseElpxScreenshotArgs(args);
	const [{ getDb, waitForDb }, repo, { hasRootScreenshot }] = await Promise.all(
		[
			import("../../../api/src/db.ts"),
			import("@procomun/db/repository"),
			import("../../../api/src/services/elpx-processor.ts"),
		],
	);
	await waitForDb();
	const db = getDb().db;

	const { getUploadConfig } = await import(
		"../../../api/src/uploads/config.ts"
	);
	const { storageDir } = getUploadConfig(process.env);

	const report = await runElpxScreenshotBackfill(options, {
		listProjects: () => repo.listElpxProjectsForScreenshotScan(db),
		setHasScreenshot: (id, value) =>
			repo.setElpxProjectHasScreenshot(db, id, value),
		inspectExtraction: async ({ hash, extractPath }) => {
			const dir = await resolveExtractionDir(extractPath, hash, storageDir);
			if (!dir) return "unreachable";
			return (await hasRootScreenshot(dir)) ? "screenshot" : "no-screenshot";
		},
	});

	console.log(
		`[elpx:screenshots]${report.dryRun ? " (dry-run)" : ""} revisados=${report.checked} con_miniatura=${report.withScreenshot} cambios=${report.changed} sin_localizar=${report.unreachable}`,
	);
}
