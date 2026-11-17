import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
	EXPECTED_MANIFESTS,
	EXPECTED_WORKSPACE_GLOBS,
	FORBIDDEN_LOCKFILES,
	findCrossLayerDependencyLeaks,
	findDependabotPolicyErrors,
	findForbiddenLockfiles,
	findMissingManifests,
	findUnexpectedManifests,
	findWorkspaceGlobErrors,
	findWorkspaceIdentityErrors,
	findWorkspacePolicyErrors,
	isWorkspaceManifest,
	type PackageManifest,
	parseDependabotUpdates,
} from "./check-dependabot-workspaces.ts";

const REPO_ROOT = join(import.meta.dir, "..");

const VALID_DEPENDABOT = `
version: 2
updates:
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
  - package-ecosystem: "bun"
    directory: "/"
    schedule:
      interval: "weekly"
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 0
  - package-ecosystem: "docker"
    directory: "/"
    schedule:
      interval: "weekly"
`;

describe("parseDependabotUpdates", () => {
	test("extrae ecosistemas, directorio y el límite de PRs", () => {
		const updates = parseDependabotUpdates(VALID_DEPENDABOT);
		expect(updates).toEqual([
			{ directory: "/", ecosystem: "github-actions" },
			{ directory: "/", ecosystem: "bun" },
			{ directory: "/", ecosystem: "npm", openPullRequestsLimit: 0 },
			{ directory: "/", ecosystem: "docker" },
		]);
	});

	test("ignora entradas sin package-ecosystem", () => {
		const updates = parseDependabotUpdates(`
version: 2
updates:
  - directory: "/"
  - package-ecosystem: "bun"
    directory: "/"
`);
		expect(updates).toEqual([{ directory: "/", ecosystem: "bun" }]);
	});
});

describe("findDependabotPolicyErrors", () => {
	test("acepta bun para versiones y npm solo para seguridad", () => {
		expect(
			findDependabotPolicyErrors(parseDependabotUpdates(VALID_DEPENDABOT)),
		).toEqual([]);
	});

	test("rechaza el ecosistema npm como gestor de version updates", () => {
		const errors = findDependabotPolicyErrors(
			parseDependabotUpdates(`
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
  - package-ecosystem: "github-actions"
    directory: "/"
  - package-ecosystem: "docker"
    directory: "/"
`),
		);
		expect(
			errors.some((error) => error.includes("package-ecosystem: bun")),
		).toBe(true);
		expect(
			errors.some((error) => error.includes("open-pull-requests-limit: 0")),
		).toBe(true);
	});

	test("rechaza npm con límite distinto de 0 aunque bun esté presente", () => {
		const errors = findDependabotPolicyErrors([
			{ directory: "/", ecosystem: "bun" },
			{ directory: "/", ecosystem: "npm", openPullRequestsLimit: 5 },
			{ directory: "/", ecosystem: "github-actions" },
			{ directory: "/", ecosystem: "docker" },
		]);
		expect(errors).toEqual([
			"El ecosistema npm no puede emitir version updates: fija open-pull-requests-limit: 0 (solo security updates).",
		]);
	});

	test("exige github-actions y docker además de bun/npm", () => {
		const errors = findDependabotPolicyErrors([
			{ directory: "/", ecosystem: "bun" },
			{ directory: "/", ecosystem: "npm", openPullRequestsLimit: 0 },
		]);
		expect(errors).toContain("Falta package-ecosystem: github-actions.");
		expect(errors).toContain("Falta package-ecosystem: docker.");
	});
});

describe("inventario de package.json y lockfiles", () => {
	test("detecta un package.json extra y uno que falta", () => {
		expect(
			findUnexpectedManifests([
				"package.json",
				"apps/api/package.json",
				"apps/extra/package.json",
			]),
		).toEqual(["apps/extra/package.json"]);
		expect(
			findMissingManifests(["package.json", "apps/api/package.json"]),
		).toEqual([
			"apps/cli/package.json",
			"apps/frontend/package.json",
			"apps/thumbnailer/package.json",
			"packages/db/package.json",
		]);
		expect(
			isWorkspaceManifest("apps/frontend/src/paraglide/messages/package.json"),
		).toBe(false);
		expect(
			findUnexpectedManifests([
				"package.json",
				"apps/api/package.json",
				"apps/cli/package.json",
				"apps/frontend/package.json",
				"packages/db/package.json",
				"apps/frontend/src/paraglide/messages/package.json",
			]),
		).toEqual([]);
	});

	test("prohíbe lockfiles de npm, yarn, pnpm y bun.lockb", () => {
		expect(
			findForbiddenLockfiles(["bun.lock", "package-lock.json", "yarn.lock"]),
		).toEqual(["package-lock.json", "yarn.lock"]);
		expect(FORBIDDEN_LOCKFILES).toContain("bun.lockb");
	});

	test("exige los globs de workspaces del monorepo", () => {
		expect(findWorkspaceGlobErrors([...EXPECTED_WORKSPACE_GLOBS])).toEqual([]);
		expect(findWorkspaceGlobErrors(["packages/*"])).toHaveLength(1);
	});

	test("impide fugas de dependencias entre frontend y API", () => {
		const leaks = findCrossLayerDependencyLeaks({
			"apps/frontend/package.json": {
				dependencies: { hono: "4.13.1", react: "19.2.4" },
			},
			"apps/api/package.json": {
				dependencies: { react: "19.2.4", hono: "4.13.1" },
			},
		});
		expect(leaks.some((error) => error.includes("hono"))).toBe(true);
		expect(leaks.some((error) => error.includes("react"))).toBe(true);
	});

	test("exige identidad @procomun, private y module en cada workspace", () => {
		const errors = findWorkspaceIdentityErrors({
			"apps/api/package.json": {
				name: "api",
				private: false,
				type: "commonjs",
			},
		});
		expect(errors.length).toBeGreaterThanOrEqual(3);
	});

	test("findWorkspacePolicyErrors agrupa lockfile, manifiestos y fugas", () => {
		const errors = findWorkspacePolicyErrors({
			foundLockfiles: ["package-lock.json"],
			foundManifests: ["package.json"],
			hasBunLock: false,
			manifests: {},
			rootWorkspaces: [],
		});
		expect(errors.some((error) => error.includes("bun.lock"))).toBe(true);
		expect(errors.some((error) => error.includes("No unificar"))).toBe(true);
		expect(errors.some((error) => error.includes("package-lock.json"))).toBe(
			true,
		);
	});
});

function walkRelativeFiles(root: string, current = root): string[] {
	const entries = readdirSync(current, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		if (entry.name === "node_modules" || entry.name === ".git") continue;
		const absolute = join(current, entry.name);
		if (entry.isDirectory()) {
			files.push(...walkRelativeFiles(root, absolute));
			continue;
		}
		if (entry.isFile()) files.push(relative(root, absolute));
	}
	return files;
}

describe("repositorio real", () => {
	test("dependabot.yml cumple la política bun + npm de seguridad", () => {
		const yaml = readFileSync(
			join(REPO_ROOT, ".github/dependabot.yml"),
			"utf8",
		);
		const errors = findDependabotPolicyErrors(parseDependabotUpdates(yaml));
		expect(errors).toEqual([]);
		expect(yaml).toContain('package-ecosystem: "bun"');
		expect(yaml).toContain("open-pull-requests-limit: 0");
	});

	test("el monorepo conserva workspaces separados y un único bun.lock", () => {
		const rootManifest = JSON.parse(
			readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
		) as PackageManifest;
		const foundFiles = walkRelativeFiles(REPO_ROOT);
		const foundManifests = foundFiles.filter(
			(path) => path === "package.json" || path.endsWith("/package.json"),
		);
		const foundLockfiles = foundFiles.filter((path) =>
			FORBIDDEN_LOCKFILES.includes(
				path as (typeof FORBIDDEN_LOCKFILES)[number],
			),
		);
		const manifests: Record<string, PackageManifest> = {};
		for (const path of EXPECTED_MANIFESTS) {
			manifests[path] = JSON.parse(
				readFileSync(join(REPO_ROOT, path), "utf8"),
			) as PackageManifest;
		}

		const errors = findWorkspacePolicyErrors({
			foundLockfiles,
			foundManifests,
			hasBunLock: statSync(join(REPO_ROOT, "bun.lock")).isFile(),
			manifests,
			rootWorkspaces: rootManifest.workspaces,
		});
		expect(errors).toEqual([]);
		expect(rootManifest.workspaces).toEqual([...EXPECTED_WORKSPACE_GLOBS]);
	});
});
