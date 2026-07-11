/**
 * Editor-preview routes — host-served opaque HTTP preview (serving contract v2,
 * docs/preview-serving-contract.md).
 *
 * Two deliberately separate surfaces:
 *
 * - `previewSessionRoutes` (`/api/v1/preview-session`, session-authenticated):
 *   create sessions, upload assets, publish revisions, delete. Every endpoint
 *   is owner-gated — a user may only touch their OWN sessions. Session auth is
 *   applied for the `/api/v1/preview-session/*` pattern in `app/middleware.ts`,
 *   mirroring `/api/v1/tokens/*`.
 *
 * - `previewRoutes` (`/api/v1/preview/:previewId/*`, NO auth): serves the
 *   session's three layers to the opaque-origin preview iframe. An opaque iframe
 *   sends no SameSite cookie, so this is a capability URL (unguessable UUID +
 *   idle TTL), the same authless model as the published `/api/v1/elpx/:hash/*`
 *   route. Every response carries the hardening headers; scriptable types
 *   additionally get the `sandbox`-first CSP so a directly opened preview URL
 *   stays opaque.
 *
 * The Content-Security-Policy emitted here MUST stay BYTE-IDENTICAL to eXe core
 * `previewCspHeader()` (`src/shared/security/previewSandbox.ts`) — single line,
 * directives joined by "; ", no trailing ";". It is intentionally STRICTER than
 * the published-content CSP in `elpx-content.ts` (no `frame-src https:`,
 * `base-uri 'none'`, no `allow-popups-to-escape-sandbox`).
 *
 * Mount at `/api/v1/preview` and set the editor's
 * `embeddingConfig.previewTransport = "http"` + `previewBasePath = "/api/v1/preview"`.
 */
import { type Context, Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { requireAuth } from "../auth/middleware.ts";
import { getCurrentUser } from "../auth/roles.ts";
import * as fixedResources from "../services/preview-fixed-resources.ts";
import * as store from "../services/preview-session-store.ts";

/** Contract protocol version advertised by create-session. */
export const PROTOCOL_VERSION = 2;

/**
 * Advertised upper bound for one upload request. Oversized bodies die at the
 * transport layer (connection error, not a clean 413), so clients must batch
 * uploads below it.
 */
export const RECOMMENDED_BATCH_BYTES = 64 * 1024 * 1024;

// Server-minted preview session id: a v4-shaped UUID. Stricter than the elpx
// route's HASH_PATTERN (which also accepts SHA-1) — a preview id is never a hash.
const PREVIEW_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The sandbox-first preview CSP. MUST be byte-identical to eXe core
 * `previewCspHeader()`. Kept as a single joined string (no trailing ";").
 */
const PREVIEW_CSP = [
	"sandbox allow-scripts allow-popups allow-forms",
	"default-src 'self'",
	"script-src 'self' 'unsafe-inline' 'unsafe-eval'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob: https:",
	"media-src 'self' data: blob: https:",
	"font-src 'self' data:",
	"connect-src 'self'",
	"frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com",
	"child-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com",
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'self'",
	"frame-ancestors 'self'",
].join("; ");

const PREVIEW_PERMISSIONS_POLICY = [
	"camera=()",
	"microphone=()",
	"geolocation=()",
	"payment=()",
].join(", ");

/**
 * Hardening headers emitted on EVERY serving response, including 404s.
 * `Cache-Control` is NOT part of this set — it is tiered per resolution layer.
 */
function baseHeaders(): Record<string, string> {
	return {
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy": "no-referrer",
		"Permissions-Policy": PREVIEW_PERMISSIONS_POLICY,
		// Authless + cookieless capability route: fonts/fetch() from the opaque
		// frame are CORS-mode with Origin: null. NEVER pair "*" with credentials.
		"Access-Control-Allow-Origin": "*",
	};
}

function notFound(): Response {
	return new Response("Not found", {
		status: 404,
		headers: {
			...baseHeaders(),
			"Cache-Control": "no-store",
			"Content-Type": "text/plain; charset=utf-8",
		},
	});
}

export type ParsedRange =
	| { start: number; end: number }
	| "unsatisfiable"
	| null;

/**
 * Parse a single-range `Range` header against a body of `totalSize` bytes.
 * Returns `null` when no range was requested, an inclusive byte window when it
 * is satisfiable, and `"unsatisfiable"` for anything else (multi-range,
 * malformed, out of bounds) — the contract answers those with 416.
 */
export function parseRangeHeader(
	value: string | null | undefined,
	totalSize: number,
): ParsedRange {
	if (!value) return null;
	const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
	if (!match) return "unsatisfiable";
	const [, rawStart, rawEnd] = match;
	if (rawStart === "" && rawEnd === "") return "unsatisfiable";
	if (rawStart === "") {
		// Suffix form: last N bytes.
		const suffix = Number.parseInt(rawEnd as string, 10);
		if (suffix === 0 || totalSize === 0) return "unsatisfiable";
		return { start: Math.max(0, totalSize - suffix), end: totalSize - 1 };
	}
	const start = Number.parseInt(rawStart as string, 10);
	if (start >= totalSize) return "unsatisfiable";
	if (rawEnd === "") return { start, end: totalSize - 1 };
	const end = Number.parseInt(rawEnd as string, 10);
	if (end < start) return "unsatisfiable";
	return { start, end: Math.min(end, totalSize - 1) };
}

/** Loose `If-None-Match` evaluation: any listed entity tag (or `*`) matches. */
export function ifNoneMatchMatches(
	headerValue: string | null | undefined,
	etag: string,
): boolean {
	if (!headerValue) return false;
	return headerValue.split(",").some((candidate) => {
		const cleaned = candidate.trim().replace(/^W\//i, "").replace(/^"|"$/g, "");
		return cleaned === "*" || cleaned === etag;
	});
}

/**
 * The contract's reference serving logic: UUID gate → session lookup (touches
 * the idle-TTL clock) → three-layer `getFile` → tiered headers.
 *
 * Cache-Control tiers: documents `no-store`; session assets `no-cache` +
 * `ETag: "<assetKey>"` (+ 304 / single-range 206/416); fixed resources
 * `private, max-age=31536000`; 404s `no-store`. Every scriptable document type
 * carries the sandbox-first CSP, whatever layer resolved it.
 */
function servePreviewFile(
	previewId: string,
	relPath: string,
	requestHeaders: { ifNoneMatch?: string | null; range?: string | null },
): Response {
	if (!PREVIEW_ID_PATTERN.test(previewId)) return notFound();
	const session = store.getSessionForServing(previewId);
	if (!session) return notFound();
	const file = store.getFile(session, relPath, fixedResources);
	if (!file) return notFound();

	const headers: Record<string, string> = {
		...baseHeaders(),
		"Content-Type": file.contentType,
	};
	// Emit the sandbox-first CSP on every scriptable document type (HTML, SVG,
	// XML), not just HTML: an author SVG opened top-level would otherwise run its
	// inline <script> same-origin (nosniff does not help — SVG is already a
	// scriptable type). This applies to ANY resolution layer.
	if (file.isScriptable) {
		headers["Content-Security-Policy"] = PREVIEW_CSP;
	}

	if (file.kind === "document") {
		headers["Cache-Control"] = "no-store";
		return new Response(file.bytes, { headers });
	}

	if (file.kind === "fixed") {
		headers["Cache-Control"] = "private, max-age=31536000";
		return new Response(file.bytes, { headers });
	}

	// Session asset: revalidating cache tier with ETag + single-range support
	// (large audio/video seeks without a full re-download).
	headers["Cache-Control"] = "no-cache";
	headers.ETag = `"${file.etag}"`;
	headers["Accept-Ranges"] = "bytes";

	if (ifNoneMatchMatches(requestHeaders.ifNoneMatch, file.etag)) {
		return new Response(null, { status: 304, headers });
	}

	const total = file.bytes.length;
	const range = parseRangeHeader(requestHeaders.range, total);
	if (range === "unsatisfiable") {
		headers["Content-Range"] = `bytes */${total}`;
		return new Response(null, { status: 416, headers });
	}
	if (range !== null) {
		const body = file.bytes.slice(range.start, range.end + 1);
		headers["Content-Range"] = `bytes ${range.start}-${range.end}/${total}`;
		headers["Content-Length"] = String(body.length);
		return new Response(body, { status: 206, headers });
	}
	return new Response(file.bytes, { headers });
}

export const previewRoutes = new Hono();

// Derive the sub-path from c.req.path (Hono decodes the id segment there, the
// same way c.req.param decodes it) so an encoded hex char in the id cannot
// desync the split. NOT new URL(c.req.url).pathname, whose raw (still-encoded)
// id segment would make indexOf(decodedId) miss and strand the relPath.
// c.req.path keeps %2f encoded within the remaining segments, so traversal
// safety is still enforced by normalizeContentPath downstream.
function handlePreview(c: Context): Response {
	const previewId = c.req.param("previewId");
	if (!previewId || !PREVIEW_ID_PATTERN.test(previewId)) {
		return notFound();
	}
	const pathParts = c.req.path.split("/");
	const idIndex = pathParts.indexOf(previewId);
	const relPath = pathParts.slice(idIndex + 1).join("/") || "index.html";

	return servePreviewFile(previewId, relPath, {
		ifNoneMatch: c.req.header("if-none-match"),
		range: c.req.header("range"),
	});
}

previewRoutes.get("/:previewId", handlePreview);
previewRoutes.get("/:previewId/*", handlePreview);

// ---------------------------------------------------------------------------
// Authenticated management API (mount at `/api/v1/preview-session`).
//
// The editor creates a session, uploads session assets (immutable per key), and
// publishes atomic incremental revisions of the generated-document layer. Every
// endpoint is owner-gated: a user may only touch their OWN sessions (403
// otherwise, 404 for unknown ids).
// ---------------------------------------------------------------------------

function ownershipError(status: 403 | 404): {
	body: { error: string };
	status: 403 | 404;
} {
	return {
		body: {
			error:
				status === 403
					? "Acceso denegado"
					: "Sesión de previsualización no encontrada",
		},
		status,
	};
}

/** Accept both the raw string field and (defensively) a pre-parsed object. */
function parseJsonField(
	raw: unknown,
): { ok: true; value: unknown } | { ok: false } {
	if (typeof raw !== "string") return { ok: true, value: raw };
	try {
		return { ok: true, value: JSON.parse(raw) };
	} catch {
		return { ok: false };
	}
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every((v) => typeof v === "string")
	);
}

export const previewSessionRoutes = new Hono<AuthEnv>();

previewSessionRoutes.use("*", requireAuth);

// POST /api/v1/preview-session — create a session for the current user.
previewSessionRoutes.post("/", (c) => {
	const user = getCurrentUser(c);
	const { previewId } = store.createSession(user.id);
	const limits = store.getLimits();
	return c.json(
		{
			previewId,
			protocolVersion: PROTOCOL_VERSION,
			revision: 0,
			limits: {
				maxFilesPerSession: limits.maxFilesPerSession,
				maxBytesPerSession: limits.maxBytesPerSession,
				maxAssetBytes: limits.maxAssetBytes,
				recommendedBatchBytes: RECOMMENDED_BATCH_BYTES,
			},
		},
		201,
	);
});

// POST /api/v1/preview-session/:previewId/assets — upload session assets.
// multipart/form-data: `assets` (JSON array of `{ key, size }`) and one or more
// `files`, index-aligned. The byte budget is enforced twice — on DECLARED sizes
// before buffering and on ACTUAL bytes while buffering — so an under-reported
// size can never amplify memory.
previewSessionRoutes.post("/:previewId/assets", async (c) => {
	const user = getCurrentUser(c);
	const owned = store.getOwnedSession(c.req.param("previewId"), user.id);
	if ("status" in owned) {
		const { body, status } = ownershipError(owned.status);
		return c.json(body, status);
	}

	let form: FormData;
	try {
		form = await c.req.formData();
	} catch {
		return c.json({ error: "Se esperaba multipart/form-data" }, 400);
	}

	const parsed = parseJsonField(form.get("assets"));
	if (!parsed.ok) return c.json({ error: "assets JSON no válido" }, 400);
	const entries = parsed.value;
	if (
		!Array.isArray(entries) ||
		entries.some(
			(e) =>
				typeof e?.key !== "string" ||
				typeof e?.size !== "number" ||
				!Number.isFinite(e.size),
		)
	) {
		return c.json(
			{ error: "assets debe ser un array de entradas { key, size }" },
			400,
		);
	}

	const files = form
		.getAll("files")
		.filter((f): f is File => f instanceof File);
	if (files.length !== entries.length) {
		return c.json(
			{ error: "assets y files deben estar alineados por índice" },
			400,
		);
	}

	const limits = store.getLimits();
	const remainingBudget =
		limits.maxBytesPerSession - store.sessionBytes(owned.session);
	let declaredBytes = 0;
	for (const entry of entries as Array<{ size: number }>) {
		declaredBytes += entry.size;
		if (declaredBytes > remainingBudget) {
			return c.json(
				{ error: "La subida supera el presupuesto de bytes de la sesión" },
				413,
			);
		}
	}

	const buffered: Uint8Array[] = [];
	let bufferedBytes = 0;
	for (const file of files) {
		const bytes = new Uint8Array(await file.arrayBuffer());
		bufferedBytes += bytes.length;
		if (bufferedBytes > remainingBudget) {
			return c.json(
				{ error: "La subida supera el presupuesto de bytes de la sesión" },
				413,
			);
		}
		buffered.push(bytes);
	}

	const result = store.storeAssets(
		owned.session,
		(entries as Array<{ key: string; size: number }>).map((entry, i) => ({
			key: entry.key,
			declaredSize: entry.size,
			bytes: buffered[i] as Uint8Array,
		})),
	);
	return c.json(result);
});

// POST /api/v1/preview-session/:previewId/revisions — publish a revision.
// multipart/form-data: `revision` (JSON meta below) and one `files` part per
// `writes` entry, index-aligned:
//   { baseRevision, nextRevision, writes:[path], deletes:[path],
//     assetRefs:{path:assetKey}, fixedRefs:{path:fixedResourceId} }
previewSessionRoutes.post("/:previewId/revisions", async (c) => {
	const user = getCurrentUser(c);
	const owned = store.getOwnedSession(c.req.param("previewId"), user.id);
	if ("status" in owned) {
		const { body, status } = ownershipError(owned.status);
		return c.json(body, status);
	}

	let form: FormData;
	try {
		form = await c.req.formData();
	} catch {
		return c.json({ error: "Se esperaba multipart/form-data" }, 400);
	}

	const parsed = parseJsonField(form.get("revision"));
	if (!parsed.ok) return c.json({ error: "revision JSON no válido" }, 400);
	const meta = parsed.value as Record<string, unknown> | null;
	if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
		return c.json({ error: "revision debe ser un objeto JSON" }, 400);
	}
	if (
		!Number.isInteger(meta.baseRevision) ||
		!Number.isInteger(meta.nextRevision)
	) {
		return c.json(
			{ error: "baseRevision y nextRevision deben ser enteros" },
			400,
		);
	}
	const writes = meta.writes ?? [];
	if (!Array.isArray(writes) || writes.some((w) => typeof w !== "string")) {
		return c.json({ error: "writes debe ser un array de rutas" }, 400);
	}
	const deletes = meta.deletes ?? [];
	if (!Array.isArray(deletes) || deletes.some((d) => typeof d !== "string")) {
		return c.json({ error: "deletes debe ser un array de rutas" }, 400);
	}
	const assetRefs = meta.assetRefs ?? {};
	const fixedRefs = meta.fixedRefs ?? {};
	if (!isStringRecord(assetRefs) || !isStringRecord(fixedRefs)) {
		return c.json(
			{ error: "assetRefs y fixedRefs deben mapear rutas a ids de cadena" },
			400,
		);
	}

	const files = form
		.getAll("files")
		.filter((f): f is File => f instanceof File);
	if (files.length !== writes.length) {
		return c.json(
			{ error: "writes y files deben estar alineados por índice" },
			400,
		);
	}

	// Buffer write payloads with an amplification guard: a revision whose document
	// payload alone cannot fit the session budget is rejected before it is fully
	// materialized (the exact post-delta budget is applyRevision's job).
	const limits = store.getLimits();
	const remainingForDocuments =
		limits.maxBytesPerSession - owned.session.assetBytes;
	const bufferedWrites: Array<{ path: string; bytes: Uint8Array }> = [];
	let bufferedBytes = 0;
	for (let i = 0; i < files.length; i++) {
		const bytes = new Uint8Array(await (files[i] as File).arrayBuffer());
		bufferedBytes += bytes.length;
		if (bufferedBytes > remainingForDocuments) {
			return c.json(
				{ error: "La revisión supera el presupuesto de bytes de la sesión" },
				413,
			);
		}
		bufferedWrites.push({ path: writes[i] as string, bytes });
	}

	const result = store.applyRevision(
		owned.session,
		{
			baseRevision: meta.baseRevision as number,
			nextRevision: meta.nextRevision as number,
			writes: bufferedWrites,
			deletes: deletes as string[],
			assetRefs: assetRefs as Record<string, string>,
			fixedRefs: fixedRefs as Record<string, string>,
		},
		fixedResources,
	);
	if ("active" in result) {
		return c.json(result);
	}
	if (result.status === 409) {
		return c.json(
			{ reason: "revision-conflict", currentRevision: result.currentRevision },
			409,
		);
	}
	if (result.status === 422) {
		// Contract shape: { reason, missing } / { reason, resources } — do not leak
		// the internal status discriminant into the wire body.
		const { status, ...body } = result;
		return c.json(body, status);
	}
	return c.json({ error: result.message }, result.status);
});

// DELETE /api/v1/preview-session/:previewId — tear a session down.
previewSessionRoutes.delete("/:previewId", (c) => {
	const user = getCurrentUser(c);
	const owned = store.getOwnedSession(c.req.param("previewId"), user.id);
	if ("status" in owned) {
		const { body, status } = ownershipError(owned.status);
		return c.json(body, status);
	}
	store.deleteSession(c.req.param("previewId"));
	return c.json({ success: true });
});
