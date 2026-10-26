import { describe, expect, test } from "bun:test";
import {
	type ElpxScreenshotDeps,
	parseElpxScreenshotArgs,
	runElpxScreenshotBackfill,
} from "./elpx-screenshots.ts";

const PROJECTS = [
	{ id: "p1", hash: "h1", extractPath: "/elpx/h1", hasScreenshot: false },
	{ id: "p2", hash: "h2", extractPath: "/elpx/h2", hasScreenshot: false },
	{ id: "p3", hash: "h3", extractPath: "/elpx/h3", hasScreenshot: true },
];

function buildDeps(onDisk: Set<string>) {
	const updates: Array<[string, boolean]> = [];
	const deps: ElpxScreenshotDeps = {
		listProjects: async () => PROJECTS,
		setHasScreenshot: async (id, value) => {
			updates.push([id, value]);
		},
		hasRootScreenshot: async (extractPath) => onDisk.has(extractPath),
	};
	return { deps, updates };
}

// #409: relleno de has_screenshot para los paquetes subidos antes del cambio.
describe("runElpxScreenshotBackfill", () => {
	test("marca los paquetes con screenshot.png y corrige los que ya no la tienen", async () => {
		const { deps, updates } = buildDeps(new Set(["/elpx/h1"]));

		const report = await runElpxScreenshotBackfill({ dryRun: false }, deps);

		expect(updates).toEqual([
			["p1", true],
			["p3", false],
		]);
		expect(report).toEqual({
			checked: 3,
			withScreenshot: 1,
			changed: 2,
			dryRun: false,
		});
	});

	test("--dry-run cuenta los cambios sin escribir", async () => {
		const { deps, updates } = buildDeps(new Set(["/elpx/h1", "/elpx/h3"]));

		const report = await runElpxScreenshotBackfill({ dryRun: true }, deps);

		expect(updates).toEqual([]);
		expect(report).toEqual({
			checked: 3,
			withScreenshot: 2,
			changed: 1,
			dryRun: true,
		});
	});
});

describe("parseElpxScreenshotArgs", () => {
	test("reconoce --dry-run", () => {
		expect(parseElpxScreenshotArgs(["--dry-run"])).toEqual({ dryRun: true });
		expect(parseElpxScreenshotArgs([])).toEqual({ dryRun: false });
	});

	test("rechaza argumentos desconocidos", () => {
		expect(() => parseElpxScreenshotArgs(["--otro"])).toThrow("--otro");
	});
});
