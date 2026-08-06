/**
 * Editor preview snapshots: ephemeral, in-memory storage for the opaque preview
 * (docs/preview-serving-contract.md).
 *
 * The editor sends the WHOLE project as one ZIP on every opaque refresh and gets
 * back an unguessable capability id; the authless
 * `/api/v1/preview/{previewId}/*` route then serves that file map without a
 * session.
 *
 * This replaces the layered protocol-v2 store (immutable asset keys, incremental
 * document revisions, and a fixed-resource indirection into the installed
 * editor's manifest) — machinery whose whole purpose was to avoid re-uploading
 * unchanged bytes, for a protocol the editor no longer speaks. With one archive
 * per refresh a snapshot is just `path → bytes`, so the three layers collapse
 * into one map and `getFile` becomes a single lookup.
 *
 * Snapshots are process-local and intentionally NOT persisted: they die on
 * restart and the client transparently recreates them on the next refresh (any
 * 404 from the API or the serving route triggers a re-sync). Deployments that
 * run multiple instances behind a load balancer need sticky sessions for the
 * preview routes — see `evaluatePreviewReplicaConfig`.
 *
 * Owner ids are the platform's string user ids (better-auth `user.id`).
 */
import path from "node:path";
import {
	readSnapshotArchive,
	type SnapshotArchiveError,
} from "./preview-snapshot-archive.ts";

export interface PreviewSnapshot {
	id: string;
	ownerUserId: string;
	/** The whole published project: served path → bytes. */
	files: Map<string, Uint8Array>;
	bytes: number;
	/**
	 * Incremented on every publish. A replacement keeps the capability id, so
	 * without this an ETag built from the id alone would stay identical across
	 * refreshes and a conditional request would get a 304 for stale bytes.
	 */
	publishSeq: number;
	createdAt: number;
	lastAccessAt: number;
}

export interface PreviewSnapshotLimits {
	ttlMs: number;
	maxSnapshotsPerUser: number;
	maxFilesPerSnapshot: number;
	maxBytesPerSnapshot: number;
	globalMaxBytes: number;
	sweepIntervalMs: number;
}

export const DEFAULT_PREVIEW_SNAPSHOT_LIMITS: PreviewSnapshotLimits = {
	ttlMs: 30 * 60 * 1000,
	maxSnapshotsPerUser: 4,
	maxFilesPerSnapshot: 5000,
	maxBytesPerSnapshot: 200 * 1024 * 1024,
	globalMaxBytes: 2048 * 1024 * 1024,
	sweepIntervalMs: 60 * 1000,
};

/** Parse a positive integer env var, falling back when unset or invalid. */
function positiveInt(value: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Resolve the snapshot limits from the environment. Invalid or non-positive
 * values fall back to the defaults.
 */
export function getLimitsFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): PreviewSnapshotLimits {
	const d = DEFAULT_PREVIEW_SNAPSHOT_LIMITS;
	return {
		ttlMs:
			positiveInt(env.PREVIEW_SESSION_TTL_MINUTES, d.ttlMs / 60_000) * 60_000,
		maxSnapshotsPerUser: positiveInt(
			env.PREVIEW_MAX_SESSIONS_PER_USER,
			d.maxSnapshotsPerUser,
		),
		maxFilesPerSnapshot: positiveInt(
			env.PREVIEW_MAX_FILES_PER_SESSION,
			d.maxFilesPerSnapshot,
		),
		maxBytesPerSnapshot:
			positiveInt(
				env.PREVIEW_MAX_BYTES_PER_SESSION_MB,
				d.maxBytesPerSnapshot / (1024 * 1024),
			) *
			1024 *
			1024,
		globalMaxBytes:
			positiveInt(
				env.PREVIEW_GLOBAL_MAX_BYTES_MB,
				d.globalMaxBytes / (1024 * 1024),
			) *
			1024 *
			1024,
		sweepIntervalMs: d.sweepIntervalMs,
	};
}

/** Truthy-env test shared by the replica-topology guard. */
function isEnvFlagOn(value: string | undefined): boolean {
	return /^(1|true|yes|on)$/i.test((value ?? "").trim());
}

/**
 * Startup guard for the process-local store's one real deployment hazard.
 *
 * Preview snapshots live in this process's memory (see the module header). A
 * multi-replica deployment therefore needs sticky routing keyed on the
 * `previewId` path segment so every management and serving request for a
 * snapshot lands on the replica that owns it; otherwise previews appear to
 * vanish (sporadic 404s). We cannot reliably detect a cluster from inside one
 * process, so this is an operator ACKNOWLEDGEMENT check, not cluster detection:
 * if `PREVIEW_MULTI_REPLICA` is set but the operator has not also confirmed
 * sticky routing via `PREVIEW_STICKY_ROUTING_CONFIRMED`, return a prominent
 * warning string for the entrypoint to log. Returns `null` when the
 * configuration is coherent (single replica, or multi-replica + confirmed).
 *
 * See docs/operaciones/preview-sessions.md and ADR-0030.
 */
export function evaluatePreviewReplicaConfig(
	env: NodeJS.ProcessEnv = process.env,
): string | null {
	if (!isEnvFlagOn(env.PREVIEW_MULTI_REPLICA)) return null;
	if (isEnvFlagOn(env.PREVIEW_STICKY_ROUTING_CONFIRMED)) return null;
	return (
		"PREVIEW_MULTI_REPLICA is set but PREVIEW_STICKY_ROUTING_CONFIRMED is not. " +
		"Preview snapshots are stored in this process's memory, so multi-replica " +
		"deployments require sticky routing keyed on the previewId path segment " +
		"(management /api/v1/preview-session/:id AND serving /api/v1/preview/:id/*); " +
		"without it, requests can hit a replica that does not own the snapshot and " +
		"previews appear to vanish. Configure sticky/consistent-hash routing (see " +
		"docs/operaciones/preview-sessions.md and ADR-0030), then set " +
		"PREVIEW_STICKY_ROUTING_CONFIRMED=1 to silence this warning."
	);
}

// ---------------------------------------------------------------------------
// Traversal-safe path normalization and MIME resolution for the content map.
//
// Serving routes resolve a user-supplied relative path against this in-memory
// file map via an exact-match `Map.get()`, so a path that survives
// `normalizeContentPath` can only ever name an entry of the map — never a
// filesystem location. Ported from the eXe core `content-path.util.ts`.
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
	".js": "application/javascript",
	".mjs": "application/javascript",
	".css": "text/css",
	".json": "application/json",
	".html": "text/html",
	".htm": "text/html",
	".xhtml": "application/xhtml+xml",
	".xml": "application/xml",
	".txt": "text/plain",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".ttf": "font/ttf",
	".eot": "application/vnd.ms-fontobject",
	".mp3": "audio/mpeg",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".ogg": "audio/ogg",
	".pdf": "application/pdf",
	".zip": "application/zip",
};

/**
 * Normalize a requested relative path against the content-map root.
 *
 * Returns a safe, root-relative POSIX path, or `null` if the request escapes
 * the root (path traversal, encoded or literal), contains a NUL byte, or is
 * malformed percent-encoding.
 */
export function normalizeContentPath(relPath: string): string | null {
	let p = (relPath ?? "").split("?")[0]?.split("#")[0] ?? "";
	try {
		p = decodeURIComponent(p);
	} catch {
		return null;
	}
	// Backslashes are not path separators in the content map; treat them as
	// literal, but a NUL byte is always invalid.
	if (p.includes("\0")) return null;
	p = p.replace(/^\/+/, "");
	if (p === "") p = "index.html";
	const norm = path.posix.normalize(p);
	if (
		norm === ".." ||
		norm.startsWith("../") ||
		norm.startsWith("/") ||
		path.posix.isAbsolute(norm)
	) {
		return null;
	}
	return norm;
}

/**
 * Resolve the Content-Type for a content-map path, appending a UTF-8 charset
 * to textual types so responses paired with `X-Content-Type-Options: nosniff`
 * stay both strict and readable.
 */
export function contentTypeFor(relPath: string): string {
	const ext = path.posix.extname(relPath).toLowerCase();
	let contentType = MIME_TYPES[ext] || "application/octet-stream";
	const isTextual =
		contentType.startsWith("text/") ||
		ext === ".js" ||
		ext === ".mjs" ||
		ext === ".json" ||
		ext === ".svg" ||
		ext === ".xml" ||
		ext === ".xhtml";
	if (isTextual && !contentType.includes("charset")) {
		contentType += "; charset=utf-8";
	}
	return contentType;
}

/**
 * Scriptable document types that MUST carry the sandbox-first CSP so they stay
 * opaque even when the capability URL is opened directly (new tab / raw URL).
 *
 * Not just `text/html`: an author-supplied `image/svg+xml` (or XML with an
 * `xml-stylesheet` PI) served without the sandbox CSP executes its inline
 * `<script>` **same-origin** when opened top-level ("open image in new tab").
 * `X-Content-Type-Options: nosniff` does not help — `image/svg+xml` is already a
 * scriptable document type. So the CSP must be emitted on all of these.
 */
export function isScriptableDocumentType(contentType: string): boolean {
	const base = contentType.split(";")[0]?.trim().toLowerCase();
	return (
		base === "text/html" ||
		base === "image/svg+xml" ||
		base === "application/xml" ||
		base === "text/xml" ||
		base === "application/xhtml+xml"
	);
}

interface PreviewSnapshotDeps {
	limits: PreviewSnapshotLimits;
	now: () => number;
}

function buildDefaultDeps(): PreviewSnapshotDeps {
	return {
		limits: getLimitsFromEnv(process.env),
		now: () => Date.now(),
	};
}

let deps: PreviewSnapshotDeps = buildDefaultDeps();

const snapshots = new Map<string, PreviewSnapshot>();
/** Sum of bytes across every snapshot. */
let globalBytes = 0;
let sweeper: ReturnType<typeof setInterval> | null = null;

export function configure(newDeps: Partial<PreviewSnapshotDeps>): void {
	deps = { ...deps, ...newDeps };
}

/**
 * Restore default dependencies AND clear all snapshots and the sweeper timer.
 * Spec `afterEach` relies on this leaving no cross-test state behind.
 */
export function resetDependencies(): void {
	deps = buildDefaultDeps();
	snapshots.clear();
	globalBytes = 0;
	stopPreviewSessionSweeper();
}

export function getStats(): { snapshots: number; globalBytes: number } {
	return { snapshots: snapshots.size, globalBytes };
}

/** The limits currently in effect (route handlers advertise and enforce them). */
export function getLimits(): PreviewSnapshotLimits {
	return deps.limits;
}

function removeSnapshot(snapshot: PreviewSnapshot): void {
	globalBytes -= snapshot.bytes;
	snapshots.delete(snapshot.id);
}

/** The snapshot with the oldest lastAccessAt among `candidates`. */
function lruOf(candidates: Iterable<PreviewSnapshot>): PreviewSnapshot | null {
	let lru: PreviewSnapshot | null = null;
	for (const snapshot of candidates) {
		if (!lru || snapshot.lastAccessAt < lru.lastAccessAt) lru = snapshot;
	}
	return lru;
}

export type ReplaceSnapshotResult =
	| { ok: true; previewId: string }
	| { ok: false; status: 400 | 403 | 404 | 413; error: string };

/**
 * Publish a whole-project snapshot, creating a capability or replacing one in
 * place.
 *
 * `previewId` is absent on the first refresh and present afterwards. A
 * capability that is unknown or owned by somebody else is refused, so it cannot
 * be claimed from another author. The new file map is only swapped in once the
 * archive has been fully vetted and unpacked, so a rejected upload leaves the
 * previous snapshot exactly as it was.
 */
export async function replaceSnapshot(
	ownerUserId: string,
	zip: Uint8Array,
	previewId?: string,
): Promise<ReplaceSnapshotResult> {
	let existing: PreviewSnapshot | undefined;
	if (previewId !== undefined && previewId !== "") {
		existing = snapshots.get(previewId);
		if (!existing)
			return { ok: false, status: 404, error: "Preview not found" };
		if (existing.ownerUserId !== ownerUserId) {
			return { ok: false, status: 403, error: "Access denied" };
		}
	}

	const archive = await readSnapshotArchive(zip, {
		maxFiles: deps.limits.maxFilesPerSnapshot,
		maxBytes: deps.limits.maxBytesPerSnapshot,
	});
	if (!archive.ok) {
		return {
			ok: false,
			status: statusForArchiveError(archive.error),
			error: archive.error.message,
		};
	}

	// Evict this author's least-recently-used snapshot before minting a new
	// capability, so one author cannot accumulate them.
	if (!existing) {
		const owned = [...snapshots.values()].filter(
			(s) => s.ownerUserId === ownerUserId,
		);
		if (owned.length >= deps.limits.maxSnapshotsPerUser) {
			const lru = lruOf(owned);
			if (lru) removeSnapshot(lru);
		}
	}

	// Make room globally, never evicting the snapshot being replaced.
	const outgoing = existing?.bytes ?? 0;
	while (globalBytes - outgoing + archive.bytes > deps.limits.globalMaxBytes) {
		const candidates = [...snapshots.values()].filter(
			(s) => s.id !== existing?.id,
		);
		const lru = lruOf(candidates);
		if (!lru) {
			return {
				ok: false,
				status: 413,
				error: "Preview storage budget exceeded",
			};
		}
		removeSnapshot(lru);
	}

	const now = deps.now();
	if (existing) {
		globalBytes += archive.bytes - existing.bytes;
		existing.files = archive.files;
		existing.bytes = archive.bytes;
		existing.publishSeq += 1;
		existing.lastAccessAt = now;
		return { ok: true, previewId: existing.id };
	}

	const snapshot: PreviewSnapshot = {
		id: crypto.randomUUID(),
		ownerUserId,
		files: archive.files,
		bytes: archive.bytes,
		publishSeq: 1,
		createdAt: now,
		lastAccessAt: now,
	};
	snapshots.set(snapshot.id, snapshot);
	globalBytes += snapshot.bytes;
	return { ok: true, previewId: snapshot.id };
}

/** Map an archive rejection onto the HTTP status the route should return. */
function statusForArchiveError(error: SnapshotArchiveError): 400 | 413 {
	return error.code === "too-large" || error.code === "too-many-files"
		? 413
		: 400;
}

export type OwnershipResult =
	| { snapshot: PreviewSnapshot }
	| { status: 403 | 404 };

export function getOwnedSnapshot(
	previewId: string,
	ownerUserId: string,
): OwnershipResult {
	const snapshot = snapshots.get(previewId);
	if (!snapshot) return { status: 404 };
	if (snapshot.ownerUserId !== ownerUserId) return { status: 403 };
	snapshot.lastAccessAt = deps.now();
	return { snapshot };
}

/** Lookup for the authless serving route; touches the LRU clock. */
export function getSnapshotForServing(
	previewId: string,
): PreviewSnapshot | null {
	const snapshot = snapshots.get(previewId);
	if (!snapshot) return null;
	snapshot.lastAccessAt = deps.now();
	return snapshot;
}

export function deleteSnapshot(previewId: string): boolean {
	const snapshot = snapshots.get(previewId);
	if (!snapshot) return false;
	removeSnapshot(snapshot);
	return true;
}

// ===========================================================================
// Serving
// ===========================================================================

export type PreviewFile = {
	kind: "document" | "asset";
	bytes: Uint8Array;
	contentType: string;
	isScriptable: boolean;
	etag: string;
};

/**
 * Resolve a served path against a snapshot's file map.
 *
 * A scriptable type is a `document` (rewritten on every refresh, so `no-store`);
 * everything else is an `asset`, revalidated with an ETag. The ETag is derived
 * from the snapshot id and the path — both change when the snapshot is replaced,
 * because a replacement mints a new file map — so it never has to hash bytes.
 */
export function getFile(
	snapshot: PreviewSnapshot,
	rawPath: string,
): PreviewFile | null {
	const p = normalizeContentPath(rawPath);
	if (p === null) return null;
	const bytes = snapshot.files.get(p);
	if (bytes === undefined) return null;

	const contentType = contentTypeFor(p);
	const isScriptable = isScriptableDocumentType(contentType);
	return {
		kind: isScriptable ? "document" : "asset",
		bytes,
		contentType,
		isScriptable,
		etag: `${snapshot.id}-${snapshot.publishSeq}-${p}`,
	};
}

/**
 * Remove every snapshot idle longer than the TTL. Returns the count swept.
 */
export function sweepExpired(): number {
	const now = deps.now();
	let swept = 0;
	for (const snapshot of [...snapshots.values()]) {
		if (now - snapshot.lastAccessAt > deps.limits.ttlMs) {
			removeSnapshot(snapshot);
			swept++;
		}
	}
	return swept;
}

/**
 * Start the idle-snapshot sweeper. Idempotent: calling it again replaces any
 * existing timer. The server entrypoint (`index.ts`) starts it at boot.
 */
export function startPreviewSessionSweeper(
	intervalMs: number = deps.limits.sweepIntervalMs,
): void {
	stopPreviewSessionSweeper();
	sweeper = setInterval(() => {
		sweepExpired();
	}, intervalMs);
	// Do not keep the process alive solely for this timer.
	if (typeof sweeper.unref === "function") {
		sweeper.unref();
	}
}

export function stopPreviewSessionSweeper(): void {
	if (sweeper) {
		clearInterval(sweeper);
		sweeper = null;
	}
}
