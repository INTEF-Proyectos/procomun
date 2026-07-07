/**
 * Editor-preview serving route — host-served opaque HTTP preview.
 *
 * Reference adapter of the eXeLearning **Preview Serving Contract**
 * (eXe core `doc/development/preview-serving-contract.md`). It serves the editor
 * preview of UNTRUSTED author HTML/JS in a browser-enforced **opaque origin**
 * over an authless capability URL, so the preview gets real per-page URLs
 * (working intra-content navigation and open-in-new-tab) instead of the srcdoc
 * fallback.
 *
 * The Content-Security-Policy emitted here MUST stay BYTE-IDENTICAL to eXe core
 * `previewCspHeader()` (`src/shared/security/previewSandbox.ts`) — single line,
 * directives joined by "; ", no trailing ";". It is intentionally STRICTER than
 * the published-content CSP in `elpx-content.ts` (no `frame-src https:`,
 * `base-uri 'none'`, no `allow-popups-to-escape-sandbox`): the preview must use
 * the strict core string. Add a drift check (mirror `check-embed-sync`).
 *
 * Mount at `/api/v1/preview` and set the editor's
 * `embeddingConfig.previewTransport = "http"` + `previewBasePath = "/api/v1/preview"`.
 *
 * The preview SESSION STORE and the authenticated MANAGEMENT API
 * (`previewSessionRoutes`, mounted at `/api/v1/preview-session`) live alongside
 * the authless serving half in this file. The store is in-memory and
 * content-addressed (`../services/preview-session-store.ts`); `getPreviewFile()`
 * reads exclusively from the promoted ACTIVE manifest via an exact-key lookup,
 * never a filesystem read.
 */
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { requireAuth } from "../auth/middleware.ts";
import { getCurrentUser } from "../auth/roles.ts";
import * as store from "../services/preview-session-store.ts";

// Server-minted preview session id: a v4-shaped UUID. Stricter than the elpx
// route's HASH_PATTERN (which also accepts SHA-1) — a preview id is never a hash.
const PREVIEW_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Document types that MUST carry the sandbox CSP. Not just text/html: an author
// SVG opened top-level ("open image in new tab") executes its inline <script>
// same-origin without the CSP; nosniff does not help — image/svg+xml is already
// a scriptable document type.
const SCRIPTABLE_TYPES = new Set([
	"text/html",
	"image/svg+xml",
	"application/xml",
	"application/xhtml+xml",
]);

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

/** Hardening headers emitted on EVERY serving response, including 404s. */
function baseHeaders(): Record<string, string> {
	return {
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy": "no-referrer",
		"Cache-Control": "no-store",
		"Permissions-Policy": PREVIEW_PERMISSIONS_POLICY,
		// Authless + cookieless capability route: fonts/fetch() from the opaque
		// frame are CORS-mode with Origin: null. NEVER pair "*" with credentials.
		"Access-Control-Allow-Origin": "*",
	};
}

function notFound(): Response {
	return new Response("Not found", {
		status: 404,
		headers: { ...baseHeaders(), "Content-Type": "text/plain; charset=utf-8" },
	});
}

type PreviewFile = { bytes: Uint8Array | ArrayBuffer; contentType: string };

/**
 * Resolve a file from the preview session's ACTIVE manifest.
 *
 * Backed by the in-memory content-addressed store
 * (`../services/preview-session-store.ts`): every uploaded blob is re-hashed
 * server-side and only a fully promoted manifest is ever served, so this is a
 * pure exact-key lookup in RAM — normalise + reject traversal, never a real
 * filesystem read. `getSessionForServing` is authless (capability URL) and
 * touches the idle-TTL clock; a missing session/path yields `null` → the route
 * 404s and the client transparently re-syncs.
 */
async function getPreviewFile(
	previewId: string,
	relPath: string,
): Promise<PreviewFile | null> {
	const session = store.getSessionForServing(previewId);
	if (!session) return null;
	const file = store.getFile(session, relPath);
	if (!file) return null;
	return { bytes: file.bytes, contentType: file.contentType };
}

export const previewRoutes = new Hono();

// Signature mirrors elpx-content.ts's handleContent (Procomún uses `c: any` and
// derives the sub-path from the URL, not a wildcard param).
async function handlePreview(c: any): Promise<Response> {
	const previewId = c.req.param("previewId");
	if (!previewId || !PREVIEW_ID_PATTERN.test(previewId)) {
		return notFound();
	}
	const url = new URL(c.req.url);
	const pathParts = url.pathname.split("/");
	const idIndex = pathParts.indexOf(previewId);
	const relPath = pathParts.slice(idIndex + 1).join("/") || "index.html";

	const file = await getPreviewFile(previewId, relPath);
	if (!file) {
		return notFound();
	}

	const headers: Record<string, string> = {
		...baseHeaders(),
		"Content-Type": file.contentType,
	};
	// Emit the opaque sandbox CSP on every scriptable document type so a directly
	// opened capability URL (new tab / raw URL) stays opaque.
	const baseType = file.contentType.split(";")[0].trim().toLowerCase();
	if (SCRIPTABLE_TYPES.has(baseType)) {
		headers["Content-Security-Policy"] = PREVIEW_CSP;
	}
	return new Response(file.bytes, { headers });
};

previewRoutes.get("/:previewId", handlePreview);
previewRoutes.get("/:previewId/*", handlePreview);

// ---------------------------------------------------------------------------
// Authenticated management API (mount at `/api/v1/preview-session`).
//
// The editor creates a session, stages a path→sha256 manifest, uploads only the
// blobs the store lacks, and deletes it on teardown. Every endpoint is
// owner-gated: a user may only touch their OWN sessions (403 otherwise, 404 for
// unknown ids). Session auth is applied for the `/api/v1/preview-session/*`
// pattern in `app/middleware.ts`, mirroring `/api/v1/tokens/*`.
// ---------------------------------------------------------------------------

/**
 * Advertised upper bound for one `/blobs` request. Oversized bodies die at the
 * transport layer (connection error, not a clean 413), so clients must batch
 * uploads below it.
 */
export const RECOMMENDED_BATCH_BYTES = 64 * 1024 * 1024;

interface ManifestBody {
	files?: Record<string, { sha256: string; size: number }>;
}

function ownershipError(status: 403 | 404): { body: { error: string }; status: 403 | 404 } {
	return {
		body: { error: status === 403 ? "Acceso denegado" : "Sesión de previsualización no encontrada" },
		status,
	};
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
			limits: {
				maxFilesPerSession: limits.maxFilesPerSession,
				maxBytesPerSession: limits.maxBytesPerSession,
				recommendedBatchBytes: RECOMMENDED_BATCH_BYTES,
			},
		},
		201,
	);
});

// POST /api/v1/preview-session/:previewId/manifest — stage a manifest.
previewSessionRoutes.post("/:previewId/manifest", async (c) => {
	const user = getCurrentUser(c);
	const owned = store.getOwnedSession(c.req.param("previewId"), user.id);
	if ("status" in owned) {
		const { body, status } = ownershipError(owned.status);
		return c.json(body, status);
	}

	let body: ManifestBody | null;
	try {
		body = (await c.req.json()) as ManifestBody;
	} catch {
		return c.json({ error: "El cuerpo debe ser JSON válido" }, 400);
	}
	const files = body?.files;
	if (!files || typeof files !== "object" || Array.isArray(files)) {
		return c.json({ error: "El cuerpo debe ser { files: { [path]: { sha256, size } } }" }, 400);
	}

	const staged = store.stageManifest(owned.session, files);
	if ("status" in staged) {
		return c.json({ error: staged.message }, staged.status);
	}
	return c.json(staged);
});

// POST /api/v1/preview-session/:previewId/blobs — upload missing blobs.
// multipart/form-data: `manifestId` (string), `hashes` (JSON string array of
// declared sha256, index-aligned with the files), and one or more `files`.
previewSessionRoutes.post("/:previewId/blobs", async (c) => {
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

	const manifestId = form.get("manifestId");
	if (typeof manifestId !== "string" || manifestId === "") {
		return c.json({ error: "Falta manifestId" }, 400);
	}

	const rawHashes = form.get("hashes");
	if (typeof rawHashes !== "string") {
		return c.json({ error: "hashes debe ser un array JSON de sha256" }, 400);
	}
	let hashes: unknown;
	try {
		hashes = JSON.parse(rawHashes);
	} catch {
		return c.json({ error: "hashes JSON no válido" }, 400);
	}
	if (!Array.isArray(hashes) || hashes.some((h) => typeof h !== "string")) {
		return c.json({ error: "hashes debe ser un array de cadenas sha256" }, 400);
	}

	const files = form.getAll("files").filter((f): f is File => f instanceof File);
	if (files.length !== hashes.length) {
		return c.json({ error: "hashes y files deben estar alineados por índice" }, 400);
	}

	// Enforce the session byte budget on declared sizes BEFORE buffering
	// anything, then abort again if the actual buffered total over-runs, so an
	// oversized batch never amplifies memory (same two-stage pattern as uploads).
	const limits = store.getLimits();
	const remainingBudget = limits.maxBytesPerSession - owned.session.blobBytes;
	let declaredBytes = 0;
	for (const file of files) {
		declaredBytes += file.size;
		if (declaredBytes > remainingBudget) {
			return c.json({ error: "La subida supera el presupuesto de bytes de la sesión" }, 413);
		}
	}

	const blobs: Array<{ declaredSha256: string; bytes: Uint8Array }> = [];
	let bufferedBytes = 0;
	for (let i = 0; i < files.length; i++) {
		const file = files[i];
		if (!file) continue;
		const bytes = new Uint8Array(await file.arrayBuffer());
		bufferedBytes += bytes.length;
		if (bufferedBytes > remainingBudget) {
			return c.json({ error: "La subida supera el presupuesto de bytes de la sesión" }, 413);
		}
		blobs.push({ declaredSha256: String(hashes[i]), bytes });
	}

	const result = await store.storeBlobs(owned.session, manifestId, blobs);
	if ("status" in result) {
		return c.json({ error: result.message }, result.status);
	}
	return c.json(result);
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
