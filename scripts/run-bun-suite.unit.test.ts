import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	buildBunTestArgs,
	failureExitCode,
	findStandardTestFiles,
	findSuiteFiles,
	getMissingRequiredSuiteMessage,
	getNoTestsMessage,
	hasPassingBunSummary,
	isPassingBunExit,
} from "./run-bun-suite.ts";

describe("run-bun-suite helpers", () => {
	test("buildBunTestArgs places coverage before file paths", () => {
		expect(
			buildBunTestArgs(["apps/api/src/index.unit.test.ts"], { coverage: true }),
		).toEqual([
			"test",
			"--timeout",
			"30000",
			"--coverage",
			"apps/api/src/index.unit.test.ts",
		]);
	});

	test("buildBunTestArgs sube el límite por test a 30 s (runner propio lento)", () => {
		expect(buildBunTestArgs(["a.unit.test.ts"])).toEqual([
			"test",
			"--timeout",
			"30000",
			"a.unit.test.ts",
		]);
	});

	test("findSuiteFiles returns sorted matches from configured roots", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "procomun-suite-"));

		await mkdir(join(rootDir, "apps", "api", "src"), { recursive: true });
		await mkdir(join(rootDir, "packages", "db", "src"), { recursive: true });
		await mkdir(join(rootDir, "scripts"), { recursive: true });

		await writeFile(
			join(rootDir, "apps", "api", "src", "zeta.unit.test.ts"),
			"",
		);
		await writeFile(join(rootDir, "scripts", "alpha.unit.test.ts"), "");
		await writeFile(
			join(rootDir, "packages", "db", "src", "resource.integration.test.ts"),
			"",
		);
		await writeFile(join(rootDir, "apps", "api", "src", "ignore.spec.ts"), "");
		await writeFile(
			join(rootDir, "apps", "api", "src", "island.unit.test.tsx"),
			"",
		);

		expect(await findSuiteFiles("unit", rootDir)).toEqual([
			"apps/api/src/zeta.unit.test.ts",
			"scripts/alpha.unit.test.ts",
		]);
		expect(await findSuiteFiles("integration", rootDir)).toEqual([
			"packages/db/src/resource.integration.test.ts",
		]);
		expect(await findSuiteFiles("ui", rootDir)).toEqual([
			"apps/api/src/island.unit.test.tsx",
		]);
	});

	test("findStandardTestFiles leaves ui tests out of coverage", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "procomun-ui-"));

		await mkdir(join(rootDir, "apps", "frontend"), { recursive: true });
		await writeFile(join(rootDir, "apps", "frontend", "lib.unit.test.ts"), "");
		await writeFile(
			join(rootDir, "apps", "frontend", "Island.unit.test.tsx"),
			"",
		);

		expect(await findStandardTestFiles(rootDir)).toEqual([
			"apps/frontend/lib.unit.test.ts",
		]);
	});

	test("findStandardTestFiles combines unit and integration suites without duplicates", async () => {
		const rootDir = await mkdtemp(join(tmpdir(), "procomun-standard-"));

		await mkdir(join(rootDir, "apps", "api", "src"), { recursive: true });
		await mkdir(join(rootDir, "scripts"), { recursive: true });

		await writeFile(
			join(rootDir, "apps", "api", "src", "resource.unit.test.ts"),
			"",
		);
		await writeFile(join(rootDir, "scripts", "suite.integration.test.ts"), "");

		expect(await findStandardTestFiles(rootDir)).toEqual([
			"apps/api/src/resource.unit.test.ts",
			"scripts/suite.integration.test.ts",
		]);
	});

	test("messages distinguish skipped optional suites from missing required suites", () => {
		expect(getNoTestsMessage("integration")).toContain("skipping");
		expect(getMissingRequiredSuiteMessage("unit")).not.toContain("skipping");
	});

	test("hasPassingBunSummary only returns true for green summaries", () => {
		expect(hasPassingBunSummary(" 32 pass\n 0 fail\n")).toBe(true);
		expect(hasPassingBunSummary(" 31 pass\n 1 fail\n")).toBe(false);
	});

	test("isPassingBunExit only accepts exit 0, or 99/100 with a green summary", () => {
		expect(isPassingBunExit(0, "")).toBe(true);
		expect(isPassingBunExit(99, " 32 pass\n 0 fail\n")).toBe(true);
		expect(isPassingBunExit(100, " 32 pass\n 0 fail\n")).toBe(true);
		expect(isPassingBunExit(99, " 31 pass\n 1 fail\n")).toBe(false);
		expect(isPassingBunExit(1, " 32 pass\n 0 fail\n")).toBe(false);
		expect(isPassingBunExit(null, " 32 pass\n 0 fail\n")).toBe(false);
	});

	test("failureExitCode never turns a failed run into exit 0", () => {
		// Bun.spawnSync da exitCode null si una señal mata a bun test (p. ej. el
		// OOM killer), y process.exit(null) sale con 0.
		expect(failureExitCode(null)).toBe(1);
		expect(failureExitCode(0)).toBe(1);
		expect(failureExitCode(99)).toBe(99);
		expect(failureExitCode(1)).toBe(1);
	});
});
