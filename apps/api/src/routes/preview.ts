/**
 * Editor-preview routes — host-served opaque preview
 * (docs/preview-serving-contract.md).
 *
 * Two deliberately separate surfaces:
 *
 * - `previewSessionRoutes` (`/api/v1/preview-session`, session-authenticated):
 *   publish a whole-project snapshot and delete it. Both endpoints are
 *   owner-gated — a user may only touch their OWN snapshots. Session auth is
 *   applied for the `/api/v1/preview-session/*` pattern in `app/middleware.ts`,
 *   mirroring `/api/v1/tokens/*`.
 *
 * - `previewRoutes` (`/api/v1/preview/:previewId/*`, NO auth): serves the
 *   snapshot to the opaque-origin preview iframe. An opaque iframe sends no
 *   SameSite cookie, so this is a capability URL (unguessable UUID + idle TTL),
 *   the same authless model as the published `/api/v1/elpx/:hash/*` route. Every
 *   response carries the hardening headers; scriptable types additionally get
 *   the `sandbox`-first CSP so a directly opened preview URL stays opaque.
 *
 * The Content-Security-Policy emitted here MUST stay BYTE-IDENTICAL to eXe core
 * `previewCspHeader()` (`src/shared/security/previewSandbox.ts`) — single line,
 * directives joined by "; ", no trailing ";". It is intentionally STRICTER than
 * the published-content CSP in `elpx-content.ts` (no `frame-src https:`,
 * `base-uri 'none'`, no `allow-popups-to-escape-sandbox`).
 *
 * Mount at `/api/v1/preview` (serving) and `/api/v1/preview-session`
 * (management). The embedded editor activates the transport through the
 * `previewSnapshot` block injected by `exelearning-editor.ts`.
 */
import { type Context, Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { requireAuth } from "../auth/middleware.ts";
import { getCurrentUser } from "../auth/roles.ts";
import * as store from "../services/preview-snapshot-store.ts";

// Server-minted preview capability id: a v4-shaped UUID. Stricter than the elpx
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
 *
 * Three outcomes, matching serving contract v2 §4:
 * - `null` — no Range, OR a Range the server does not honor as a partial
 *   request: a non-`bytes` unit, a multi-range list, plain garbage, OR an
 *   INVALID single range (`bytes=5-2`, last-byte-pos < first-byte-pos — an
 *   invalid byte-range-spec per RFC 9110). Per the contract all of these are
 *   IGNORED and answered with a normal `200` full response — NOT a `416`.
 * - an inclusive `{ start, end }` window — a satisfiable single range (`206`).
 * - `"unsatisfiable"` — a VALID single range that cannot be met: first-byte-pos
 *   at/past EOF (`bytes=99-`), a zero-length suffix (`bytes=-0`), or an empty
 *   body. Only this case answers `416`.
 */
export function parseRangeHeader(
	value: string | null | undefined,
	totalSize: number,
): ParsedRange {
	if (!value) return null;
	// Anything that is not a single `bytes=<start>-<end>` request — a non-bytes
	// unit (`items=…`), a multi-range list (`bytes=0-1,3-4`), or plain garbage —
	// is not a range we serve: ignore it and fall through to the full response.
	const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
	if (!match) return null;
	const [, rawStart, rawEnd] = match;
	// `bytes=-` names neither a first-byte-pos nor a suffix-length: malformed,
	// so ignore it (full response) rather than answering 416.
	if (rawStart === "" && rawEnd === "") return null;
	if (rawStart === "") {
		// Suffix form: last N bytes. A zero-length suffix (or an empty body) is a
		// VALID but unsatisfiable range → 416.
		const suffix = Number.parseInt(rawEnd as string, 10);
		if (suffix === 0 || totalSize === 0) return "unsatisfiable";
		return { start: Math.max(0, totalSize - suffix), end: totalSize - 1 };
	}
	const start = Number.parseInt(rawStart as string, 10);
	if (rawEnd === "") {
		// Open-ended `bytes=start-`: satisfiable iff first-byte-pos is before EOF.
		return start >= totalSize ? "unsatisfiable" : { start, end: totalSize - 1 };
	}
	const end = Number.parseInt(rawEnd as string, 10);
	// last-byte-pos < first-byte-pos is an INVALID byte-range-spec (RFC 9110):
	// the header is ignored (200 full), NOT answered with 416. This structural
	// invalidity is checked BEFORE satisfiability, so it holds regardless of
	// length (e.g. `bytes=15-2` is invalid → 200, never 416).
	if (end < start) return null;
	// Valid spec; unsatisfiable only when first-byte-pos is at/past EOF.
	if (start >= totalSize) return "unsatisfiable";
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
 * Adapta un `Uint8Array` a `BodyInit` (TS 5.7+ tipa `Uint8Array` genérico con
 * `ArrayBufferLike`, incompatible con `Response`). Reutiliza el buffer cuando
 * ya es un `ArrayBuffer` completo; copia solo vistas parciales (p. ej. Range).
 */
function bodyFromBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	// Avoid copying large session assets on every full response when the view
	// already owns a complete ArrayBuffer (TS 5.7+ BodyInit needs ArrayBuffer).
	if (
		bytes.buffer instanceof ArrayBuffer &&
		bytes.byteOffset === 0 &&
		bytes.byteLength === bytes.buffer.byteLength
	) {
		return bytes as Uint8Array<ArrayBuffer>;
	}
	const copy = new Uint8Array(bytes.byteLength);
	copy.set(bytes);
	return copy;
}

/**
 * The reference serving logic: UUID gate → snapshot lookup (touches the
 * idle-TTL clock) → `getFile` → tiered headers.
 *
 * Cache-Control tiers: scriptable documents `no-store` (they are rewritten on
 * every refresh); every other file `no-cache` + `ETag` (+ 304 / single-range
 * 206/416); 404s `no-store`. Every scriptable document type carries the
 * sandbox-first CSP.
 */
function servePreviewFile(
	previewId: string,
	relPath: string,
	requestHeaders: { ifNoneMatch?: string | null; range?: string | null },
): Response {
	if (!PREVIEW_ID_PATTERN.test(previewId)) return notFound();
	const snapshot = store.getSnapshotForServing(previewId);
	if (!snapshot) return notFound();
	const file = store.getFile(snapshot, relPath);
	if (!file) return notFound();

	const headers: Record<string, string> = {
		...baseHeaders(),
		"Content-Type": file.contentType,
	};
	// Emit the sandbox-first CSP on every scriptable document type (HTML, SVG,
	// XML), not just HTML: an author SVG opened top-level would otherwise run its
	// inline <script> same-origin (nosniff does not help — SVG is already a
	// scriptable type).
	if (file.isScriptable) {
		headers["Content-Security-Policy"] = PREVIEW_CSP;
	}

	if (file.kind === "document") {
		headers["Cache-Control"] = "no-store";
		return new Response(bodyFromBytes(file.bytes), { headers });
	}

	// Non-scriptable file: revalidating cache tier with ETag + single-range
	// support (large audio/video seeks without a full re-download).
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
		return new Response(bodyFromBytes(body), { status: 206, headers });
	}
	return new Response(bodyFromBytes(file.bytes), { headers });
}

export const previewRoutes = new Hono();

/**
 * Bare-capability-URL redirect: `…/{previewId}` and `…/{previewId}/` answer a
 * `302` to the canonical entry document instead of serving index bytes inline.
 * This guarantees the iframe's relative-URL base is always `…/{previewId}/`, so
 * the entry document's sub-resources (`theme/…`, `libs/…`, `img/…`) resolve
 * correctly.
 *
 * The `Location` is RELATIVE — byte-identical to eXe core `preview-serving.ts`,
 * so it survives a BASE_PATH mount and the Electron `app://` origin without the
 * server having to know its own mount prefix: a trailing slash resolves
 * `index.html` against `…/{previewId}/`; no trailing slash resolves
 * `{previewId}/index.html` against `…/{previewId}`. Emitting the wrong one would
 * either double or drop the id segment.
 */
function redirectToIndex(location: string): Response {
	return new Response(null, {
		status: 302,
		headers: {
			...baseHeaders(),
			"Cache-Control": "no-store",
			Location: location,
		},
	});
}

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
	const relPath = pathParts.slice(idIndex + 1).join("/");
	// Bare capability URL (…/{previewId} or …/{previewId}/) → redirect to the
	// entry document rather than serving it verbatim from the bare path. Match
	// core exactly: a trailing slash → `index.html`; no slash → `{id}/index.html`.
	if (relPath === "") {
		const location = c.req.path.endsWith("/")
			? "index.html"
			: `${previewId}/index.html`;
		return redirectToIndex(location);
	}

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
// The editor publishes the WHOLE project as one archive per opaque refresh, so
// there are only two operations. Both are owner-gated: a user may only touch
// their OWN snapshots (403 otherwise, 404 for unknown ids).
//
// This replaces the four-operation protocol v2 (create session / upload assets /
// publish revision / delete) that the current editor build no longer speaks.
// ---------------------------------------------------------------------------

function ownershipError(status: 403 | 404): {
	body: { error: string };
	status: 403 | 404;
} {
	return {
		body: {
			error:
				status === 403 ? "Acceso denegado" : "Previsualización no encontrada",
		},
		status,
	};
}

export const previewSessionRoutes = new Hono<AuthEnv>();

previewSessionRoutes.use("*", requireAuth);

/**
 * POST /api/v1/preview-session — publish a whole-project snapshot.
 *
 * multipart/form-data: `snapshot` (the project ZIP) and an optional `previewId`.
 * The id is absent on the first refresh (mint a capability) and present
 * afterwards (replace in place); the store refuses an id that is unknown or
 * owned by somebody else, so a capability cannot be claimed from another author.
 *
 * No `previewUrl` is returned: the client derives it from `servingBaseUrl` +
 * `/{previewId}/index.html`, keeping one source of truth for the URL shape.
 */
previewSessionRoutes.post("/", async (c) => {
	const user = getCurrentUser(c);

	let form: FormData;
	try {
		form = await c.req.formData();
	} catch {
		return c.json({ error: "Cuerpo multipart inválido" }, 400);
	}

	const snapshot = form.get("snapshot");
	if (!(snapshot instanceof File)) {
		return c.json({ error: "Falta el archivo `snapshot`" }, 400);
	}
	const rawPreviewId = form.get("previewId");
	const previewId = typeof rawPreviewId === "string" ? rawPreviewId : undefined;
	if (previewId !== undefined && !PREVIEW_ID_PATTERN.test(previewId)) {
		return c.json({ error: "Identificador de previsualización inválido" }, 400);
	}

	const bytes = new Uint8Array(await snapshot.arrayBuffer());
	const result = await store.replaceSnapshot(user.id, bytes, previewId);
	if (!result.ok) {
		if (result.status === 403 || result.status === 404) {
			const { body, status } = ownershipError(result.status);
			return c.json(body, status);
		}
		return c.json({ error: result.error }, result.status);
	}
	return c.json({ previewId: result.previewId }, 200);
});

// DELETE /api/v1/preview-session/:previewId — drop a snapshot.
previewSessionRoutes.delete("/:previewId", (c) => {
	const user = getCurrentUser(c);
	const previewId = c.req.param("previewId");
	const owned = store.getOwnedSnapshot(previewId, user.id);
	if ("status" in owned) {
		const { body, status } = ownershipError(owned.status);
		return c.json(body, status);
	}
	store.deleteSnapshot(previewId);
	return c.json({ success: true });
});
