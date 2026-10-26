/**
 * CLI: rellena elpx_projects.has_screenshot en los paquetes subidos antes de
 * #409, mirando si tienen screenshot.png en la raíz de su extracción.
 * Uso: bun run apps/cli/src/index.ts elpx:screenshots [--dry-run]
 */

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
	hasRootScreenshot: (extractPath: string) => Promise<boolean>;
}

export interface ElpxScreenshotReport {
	checked: number;
	withScreenshot: number;
	changed: number;
	dryRun: boolean;
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
		dryRun: options.dryRun,
	};
	for (const project of await deps.listProjects()) {
		report.checked++;
		const found = await deps.hasRootScreenshot(project.extractPath);
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

	const report = await runElpxScreenshotBackfill(options, {
		listProjects: () => repo.listElpxProjectsForScreenshotScan(db),
		setHasScreenshot: (id, value) =>
			repo.setElpxProjectHasScreenshot(db, id, value),
		hasRootScreenshot,
	});

	console.log(
		`[elpx:screenshots]${report.dryRun ? " (dry-run)" : ""} revisados=${report.checked} con_miniatura=${report.withScreenshot} cambios=${report.changed}`,
	);
}
