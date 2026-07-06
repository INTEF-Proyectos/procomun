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
 * NOTE: the preview SESSION STORE and the authenticated MANAGEMENT API
 * (POST /api/v1/preview-session, /:id/manifest, /:id/blobs, DELETE /:id) are
 * FOLLOW-UP — see the TODO on `getPreviewFile()`. This file is the serving half.
 */
import { Hono } from "hono";

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
 * TODO(preview-session): back this with a store mirroring eXe core
 * `preview-session-manager.ts` — content-addressed blobs, server-side re-hash of
 * every uploaded blob, atomic manifest swap, per-session/global byte budgets,
 * and an idle-TTL sweeper — populated by the authenticated management API
 * (POST /api/v1/preview-session, /:id/manifest, /:id/blobs, DELETE /:id). Until
 * that lands this returns null (the route always 404s), so mounting it is safe.
 * Path resolution MUST be an exact key lookup in the store (normalise + reject
 * traversal), never a real filesystem read.
 */
async function getPreviewFile(
	_previewId: string,
	_relPath: string,
): Promise<PreviewFile | null> {
	return null;
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
