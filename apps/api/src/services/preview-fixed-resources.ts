/**
 * Fixed-resource resolver for the editor preview (serving contract v2, layer 1).
 *
 * Ported from eXeLearning core `preview-fixed-resources.ts`. The installed
 * static editor ships `bundles/preview-fixed-resources.json`, enumerating every
 * installation-immutable file the preview serving route may resolve outside a
 * session (libraries, base iDevice runtimes, base themes, PDF.js, content CSS,
 * logo, global fonts). This module is the ONLY path from a `fixedResourceId` to
 * the filesystem:
 *
 * - ids resolve by EXACT map lookup — client input never becomes a path;
 * - only `resources[id].path` (server-controlled build output) reaches the
 *   filesystem, resolved under the distribution root with containment checks
 *   that also reject symlink escapes (a corrupt or tampered manifest cannot read
 *   outside the distribution root);
 * - unknown ids are a lookup miss, never a filesystem probe.
 *
 * The manifest is loaded lazily and cached in module state; `configure()`
 * (tests, or a relocated distribution root) resets the cache. A missing or
 * invalid manifest is non-fatal: the fixed layer is simply disabled (revisions
 * that carry `fixedRefs` get a 422 and the client demotes those paths to
 * document writes), warned about once.
 */
import fs from "node:fs";
import path from "node:path";

export interface FixedResourceEntry {
	path: string;
	size: number;
}

export interface FixedResourceManifest {
	schemaVersion: number;
	buildVersion: string;
	resources: Record<string, FixedResourceEntry>;
}

interface FixedResourcesDeps {
	/** Distribution root every manifest path must stay under. */
	distRoot: string;
	/** Location of the build-emitted manifest JSON. */
	manifestPath: string;
}

/**
 * The installed static editor lives under `apps/api/static/exelearning-editor/
 * static`; the fixed-resource manifest is emitted into its `bundles/` directory.
 */
function buildDefaultDeps(): FixedResourcesDeps {
	const distRoot = path.join(
		import.meta.dir,
		"..",
		"..",
		"static",
		"exelearning-editor",
		"static",
	);
	return {
		distRoot,
		manifestPath: path.join(
			distRoot,
			"bundles",
			"preview-fixed-resources.json",
		),
	};
}

let deps: FixedResourcesDeps = buildDefaultDeps();

/** Lazily loaded manifest cache; `null` means not loaded yet. */
let cachedResources: Map<string, FixedResourceEntry> | null = null;
let warnedUnavailable = false;

export function configure(newDeps: Partial<FixedResourcesDeps>): void {
	deps = { ...deps, ...newDeps };
	cachedResources = null;
	warnedUnavailable = false;
}

export function resetDependencies(): void {
	deps = buildDefaultDeps();
	cachedResources = null;
	warnedUnavailable = false;
}

/**
 * Load and validate the manifest once. A missing or invalid manifest resolves
 * to an empty map (the server keeps running; revisions carrying fixedRefs get
 * a 422 and the client demotes those paths to document writes) — but it is
 * warned about once, because it usually means the static editor build step was
 * skipped or predates protocol v2.
 */
function loadResources(): Map<string, FixedResourceEntry> {
	if (cachedResources) return cachedResources;
	let parsed: FixedResourceManifest | null = null;
	try {
		parsed = JSON.parse(
			fs.readFileSync(deps.manifestPath, "utf-8"),
		) as FixedResourceManifest;
	} catch {
		parsed = null;
	}
	const valid =
		parsed !== null &&
		parsed.schemaVersion === 1 &&
		typeof parsed.resources === "object";
	if (!valid && !warnedUnavailable) {
		warnedUnavailable = true;
		console.warn(
			`[preview-fixed-resources] No valid manifest at ${deps.manifestPath}; ` +
				"the preview fixed layer is disabled.",
		);
	}
	const map = new Map<string, FixedResourceEntry>();
	if (valid && parsed) {
		for (const [id, entry] of Object.entries(parsed.resources)) {
			if (entry && typeof entry.path === "string") map.set(id, entry);
		}
	}
	cachedResources = map;
	return map;
}

/** True when `child` equals `parent` or lies strictly inside it. */
function isInsideRoot(child: string, parent: string): boolean {
	return child === parent || child.startsWith(parent + path.sep);
}

/** Exact-id membership test (the applyRevision validation hook). */
export function hasResource(id: string): boolean {
	return loadResources().has(id);
}

/** All ids the manifest declares (diagnostics / conformance tooling). */
export function getManifestIds(): string[] {
	return [...loadResources().keys()];
}

/**
 * Resolve a fixed resource id to its bytes. Returns `null` for unknown ids,
 * manifest paths escaping the distribution root (path arithmetic or symlinks),
 * and missing files. Client-supplied data can only ever be the exact-match `id`.
 */
export function getResource(
	id: string,
): { bytes: Uint8Array; size: number } | null {
	const entry = loadResources().get(id);
	if (!entry) return null;

	let rootReal: string;
	try {
		rootReal = fs.realpathSync(deps.distRoot);
	} catch {
		return null;
	}
	// Containment on the resolved (lexical) path first: rejects absolute
	// manifest paths and `..` escapes without touching the filesystem.
	const resolved = path.resolve(rootReal, entry.path);
	if (!isInsideRoot(resolved, rootReal)) return null;
	// Then on the realpath: a symlink inside the root pointing outside it must
	// not be followed out of the distribution.
	let real: string;
	try {
		real = fs.realpathSync(resolved);
	} catch {
		return null; // listed in the manifest but absent on disk
	}
	if (!isInsideRoot(real, rootReal)) return null;

	try {
		const bytes = fs.readFileSync(real);
		return {
			bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
			size: bytes.byteLength,
		};
	} catch {
		return null;
	}
}
