/**
 * Valida la política de Dependabot (ADR-0040) y el inventario de
 * package.json del monorepo Bun. No unifica manifiestos: cada workspace
 * declara sus dependencias; la raíz solo orquesta workspaces y tooling.
 */

export type DependabotUpdate = {
	directory?: string;
	ecosystem: string;
	openPullRequestsLimit?: number;
};

export type PackageManifest = {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	name?: string;
	private?: boolean;
	type?: string;
	workspaces?: string[];
};

export const EXPECTED_WORKSPACE_GLOBS = ["apps/*", "packages/*"] as const;

export const EXPECTED_WORKSPACE_MANIFESTS = [
	"apps/api/package.json",
	"apps/cli/package.json",
	"apps/frontend/package.json",
	"packages/db/package.json",
] as const;

export const EXPECTED_MANIFESTS = [
	"package.json",
	...EXPECTED_WORKSPACE_MANIFESTS,
] as const;

export const FORBIDDEN_LOCKFILES = [
	"package-lock.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"bun.lockb",
] as const;

export const FRONTEND_FORBIDDEN_DEPS = [
	"hono",
	"@tus/server",
	"@tus/file-store",
	"drizzle-orm",
	"better-auth",
] as const;

export const API_FORBIDDEN_DEPS = ["react", "react-dom", "vite"] as const;

const SECURITY_ONLY_NPM_LIMIT = 0;

export function parseDependabotUpdates(yamlText: string): DependabotUpdate[] {
	const parsed = Bun.YAML.parse(yamlText) as {
		updates?: Array<{
			directory?: string;
			"open-pull-requests-limit"?: number;
			"package-ecosystem"?: string;
		}>;
	};

	return (parsed.updates ?? [])
		.filter((entry) => typeof entry?.["package-ecosystem"] === "string")
		.map((entry) => ({
			directory: entry.directory,
			ecosystem: entry["package-ecosystem"] ?? "",
			openPullRequestsLimit: entry["open-pull-requests-limit"],
		}));
}

function isRootDirectory(directory: string | undefined): boolean {
	return directory === "/" || directory === undefined;
}

export function findDependabotPolicyErrors(
	updates: DependabotUpdate[],
): string[] {
	const errors: string[] = [];
	const bun = updates.find(
		(update) => update.ecosystem === "bun" && isRootDirectory(update.directory),
	);
	const npm = updates.find(
		(update) => update.ecosystem === "npm" && isRootDirectory(update.directory),
	);
	const actions = updates.find(
		(update) => update.ecosystem === "github-actions",
	);
	const docker = updates.find((update) => update.ecosystem === "docker");

	if (!bun) {
		errors.push(
			"Falta package-ecosystem: bun en directory: /. Dependabot debe actualizar bun.lock de forma nativa.",
		);
	}

	if (!npm) {
		errors.push(
			"Falta package-ecosystem: npm en directory: / con open-pull-requests-limit: 0. Bun no soporta security updates.",
		);
	} else if (npm.openPullRequestsLimit !== SECURITY_ONLY_NPM_LIMIT) {
		errors.push(
			"El ecosistema npm no puede emitir version updates: fija open-pull-requests-limit: 0 (solo security updates).",
		);
	}

	if (!actions) {
		errors.push("Falta package-ecosystem: github-actions.");
	}
	if (!docker) {
		errors.push("Falta package-ecosystem: docker.");
	}

	return errors;
}

/** Manifiestos de workspace: raíz o un nivel bajo apps/ o packages/. */
const WORKSPACE_MANIFEST_RE = /^(apps|packages)\/[^/]+\/package\.json$/;

export function isWorkspaceManifest(path: string): boolean {
	return path === "package.json" || WORKSPACE_MANIFEST_RE.test(path);
}

export function findUnexpectedManifests(
	found: readonly string[],
	expected: readonly string[] = EXPECTED_MANIFESTS,
): string[] {
	const allowed = new Set(expected);
	return [...found]
		.filter((path) => isWorkspaceManifest(path) && !allowed.has(path))
		.sort();
}

export function findMissingManifests(
	found: readonly string[],
	expected: readonly string[] = EXPECTED_MANIFESTS,
): string[] {
	const present = new Set(found);
	return expected.filter((path) => !present.has(path));
}

export function findForbiddenLockfiles(
	found: readonly string[],
	forbidden: readonly string[] = FORBIDDEN_LOCKFILES,
): string[] {
	const present = new Set(found);
	return forbidden.filter((path) => present.has(path));
}

export function findWorkspaceGlobErrors(
	rootWorkspaces: readonly string[] | undefined,
): string[] {
	const actual = [...(rootWorkspaces ?? [])].sort();
	const expected = [...EXPECTED_WORKSPACE_GLOBS].sort();
	if (actual.join("\0") === expected.join("\0")) return [];
	return [
		`package.json raíz debe declarar workspaces ${JSON.stringify(expected)}; encontrado ${JSON.stringify(actual)}.`,
	];
}

function declaredDependencyNames(manifest: PackageManifest): string[] {
	return [
		...Object.keys(manifest.dependencies ?? {}),
		...Object.keys(manifest.devDependencies ?? {}),
	];
}

export function findCrossLayerDependencyLeaks(
	manifests: Record<string, PackageManifest>,
): string[] {
	const errors: string[] = [];
	const frontend = manifests["apps/frontend/package.json"];
	const api = manifests["apps/api/package.json"];

	if (frontend) {
		const names = new Set(declaredDependencyNames(frontend));
		for (const dep of FRONTEND_FORBIDDEN_DEPS) {
			if (names.has(dep)) {
				errors.push(
					`apps/frontend/package.json no puede declarar ${dep}: mezclaría el frontend con la API si se unificaran los manifiestos.`,
				);
			}
		}
	}

	if (api) {
		const names = new Set(declaredDependencyNames(api));
		for (const dep of API_FORBIDDEN_DEPS) {
			if (names.has(dep)) {
				errors.push(
					`apps/api/package.json no puede declarar ${dep}: mezclaría la API con el frontend si se unificaran los manifiestos.`,
				);
			}
		}
	}

	return errors;
}

export function findWorkspaceIdentityErrors(
	manifests: Record<string, PackageManifest>,
): string[] {
	const errors: string[] = [];
	for (const path of EXPECTED_WORKSPACE_MANIFESTS) {
		const manifest = manifests[path];
		if (!manifest) continue;
		if (!manifest.name?.startsWith("@procomun/")) {
			errors.push(
				`${path} debe tener name @procomun/*; encontrado ${manifest.name ?? "(vacío)"}.`,
			);
		}
		if (manifest.private !== true) {
			errors.push(`${path} debe ser private: true.`);
		}
		if (manifest.type !== "module") {
			errors.push(`${path} debe ser type: module.`);
		}
	}
	return errors;
}

export type WorkspacePolicyInput = {
	foundLockfiles: readonly string[];
	foundManifests: readonly string[];
	hasBunLock: boolean;
	manifests: Record<string, PackageManifest>;
	rootWorkspaces: readonly string[] | undefined;
};

export function findWorkspacePolicyErrors(
	input: WorkspacePolicyInput,
): string[] {
	const errors: string[] = [];
	if (!input.hasBunLock) {
		errors.push(
			"Falta bun.lock en la raíz. Es el lockfile canónico del monorepo.",
		);
	}
	errors.push(...findWorkspaceGlobErrors(input.rootWorkspaces));
	for (const missing of findMissingManifests(input.foundManifests)) {
		errors.push(
			`Falta el manifiesto de workspace ${missing}. No unificar en un solo package.json.`,
		);
	}
	for (const extra of findUnexpectedManifests(input.foundManifests)) {
		errors.push(`Manifiesto package.json inesperado: ${extra}.`);
	}
	for (const lockfile of findForbiddenLockfiles(input.foundLockfiles)) {
		errors.push(
			`Lockfile prohibido (${lockfile}): el gestor canónico es Bun, no npm/yarn/pnpm.`,
		);
	}
	errors.push(...findWorkspaceIdentityErrors(input.manifests));
	errors.push(...findCrossLayerDependencyLeaks(input.manifests));
	return errors;
}
