/**
 * Editor-preview serving route — host-served opaque HTTP preview.
 *
 * The authenticated management route replaces one complete ZIP snapshot. The
 * authless serving route resolves files through an expiring capability. There
 * are deliberately no layers, revisions, deltas, fixed-resource manifests, or
 * external-media overlays.
 *
 * The response CSP mirrors the core iframe's functional sandbox tokens while
 * adding resource restrictions suitable for the capability route. It is
 * intentionally stricter than the published-content CSP in `elpx-content.ts`:
 * it limits nested frames, uses `base-uri 'none'`, and does not allow popups to
 * escape the sandbox.
 *
 * See `docs/preview-serving-contract.md` for the two-route contract.
 */
import * as repo from "@procomun/db/repository";
import { type Context, Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { canManageResource } from "../auth/roles.ts";
import { getDb } from "../db.ts";
import {
	PreviewSnapshotError,
	PreviewSnapshotStore,
	previewSnapshotStore,
} from "../services/preview-snapshot-store.ts";

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
 * Sandbox-first preview CSP, kept as a single joined string without a trailing
 * semicolon so emitted headers remain deterministic.
 */
const PREVIEW_CSP = [
	"sandbox allow-scripts allow-popups allow-forms allow-downloads allow-presentation",
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

// Signature mirrors elpx-content.ts's handleContent (Procomún uses `c: any` and
// derives the sub-path from the URL, not a wildcard param).
async function handlePreview(c: Context, store: PreviewSnapshotStore): Promise<Response> {
	const previewId = c.req.param("previewId");
	if (!previewId || !PREVIEW_ID_PATTERN.test(previewId)) {
		return notFound();
	}
	const url = new URL(c.req.url);
	const pathParts = url.pathname.split("/");
	const idIndex = pathParts.indexOf(previewId);
	const relPath = pathParts.slice(idIndex + 1).join("/") || "index.html";

	const file = store.get(previewId, relPath);
	if (!file) {
		return notFound();
	}

	const headers: Record<string, string> = {
		...baseHeaders(),
		"Content-Type": file.contentType,
	};
	// Emit the opaque sandbox CSP on every scriptable document type so a directly
	// opened capability URL (new tab / raw URL) stays opaque.
	const baseType = (file.contentType.split(";")[0] ?? "").trim().toLowerCase();
	if (SCRIPTABLE_TYPES.has(baseType)) {
		headers["Content-Security-Policy"] = PREVIEW_CSP;
	}
	return new Response(file.bytes, { headers });
}

export function createPreviewServingRoutes(store: PreviewSnapshotStore = previewSnapshotStore): Hono {
	const routes = new Hono();
	routes.get("/:previewId", (c) => handlePreview(c, store));
	routes.get("/:previewId/*", (c) => handlePreview(c, store));
	return routes;
}

export const previewServingRoutes = createPreviewServingRoutes();

type ProjectAuthorizer = (user: { id: string; role?: string | null }, projectId: string) => Promise<boolean>;

async function defaultProjectAuthorizer(user: { id: string; role?: string | null }, projectId: string): Promise<boolean> {
	const resource = await repo.getResourceById(getDb().db, projectId);
	return Boolean(resource && canManageResource({ id: user.id, role: user.role ?? undefined }, resource));
}

function sameOriginRequest(request: Request): boolean {
	const origin = request.headers.get("Origin");
	return Boolean(origin && origin === new URL(request.url).origin);
}

function errorResponse(c: Context<AuthEnv>, error: unknown): Response {
	if (!(error instanceof PreviewSnapshotError)) return c.json({ error: "No se pudo actualizar la previsualización" }, 500);
	const status = error.code === "forbidden" ? 403 : error.code === "not-found" ? 404 : error.code === "too-large" ? 413 : 400;
	return c.json({ error: error.message }, status);
}

export function createPreviewManagementRoutes(
	store: PreviewSnapshotStore = previewSnapshotStore,
	authorizeProject: ProjectAuthorizer = defaultProjectAuthorizer,
): Hono<AuthEnv> {
	const routes = new Hono<AuthEnv>();
	routes.post("/:projectId", async (c) => {
		const user = c.get("user");
		const projectId = c.req.param("projectId");
		if (!user) return c.json({ error: "No autenticado" }, 401);
		if (!sameOriginRequest(c.req.raw)) return c.json({ error: "Origen no válido" }, 403);
		if (!(await authorizeProject(user, projectId))) return c.json({ error: "Recurso no encontrado" }, 404);
		const form = await c.req.formData();
		const snapshot = form.get("snapshot");
		if (!(snapshot instanceof File)) return c.json({ error: "Falta el snapshot ZIP" }, 400);
		try {
			const previewId = await store.replace({
				ownerId: user.id,
				projectId,
				previewId: typeof form.get("previewId") === "string" ? String(form.get("previewId")) : undefined,
				archive: new Uint8Array(await snapshot.arrayBuffer()),
			});
			return c.json({ previewId, previewUrl: `${new URL(c.req.url).origin}/exe-preview/${previewId}/index.html` });
		} catch (error) {
			return errorResponse(c, error);
		}
	});
	routes.delete("/:projectId/:previewId", async (c) => {
		const user = c.get("user");
		const { projectId, previewId } = c.req.param();
		if (!user) return c.json({ error: "No autenticado" }, 401);
		if (!sameOriginRequest(c.req.raw)) return c.json({ error: "Origen no válido" }, 403);
		if (!(await authorizeProject(user, projectId))) return c.json({ error: "Recurso no encontrado" }, 404);
		try {
			return store.delete(user.id, projectId, previewId) ? c.body(null, 204) : c.json({ error: "No encontrado" }, 404);
		} catch (error) {
			return errorResponse(c, error);
		}
	});
	return routes;
}

export const previewManagementRoutes = createPreviewManagementRoutes();
