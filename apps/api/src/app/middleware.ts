import type { Hono } from "hono";
import { cors } from "hono/cors";
import { auditMiddleware } from "../auth/audit.ts";
import { auth } from "../auth/config.ts";
import { type AuthEnv, sessionMiddleware } from "../auth/middleware.ts";
import { getAuthBaseUrl } from "../auth/urls.ts";

const sessionProtectedApiPatterns = [
	"/api/admin/*",
	"/api/dev/*",
	"/api/uploads/*",
	"/api/v1/tokens/*",
	// Preview-session management is owner-gated; the authless serving route
	// (`/api/v1/preview/*`) is deliberately NOT listed — it is a capability URL.
	"/api/v1/preview-session/*",
];

const sessionProtectedSocialPatterns = [
	"/api/v1/resources/*/ratings",
	"/api/v1/resources/*/comments",
	"/api/v1/resources/*/favorite",
	"/api/v1/resources/*/download",
	"/api/v1/resources/*/stats",
	"/api/v1/users/*",
	"/api/v1/comments/*",
];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

interface PreviewManagementRequestMetadata {
	method: string;
	path: string;
	origin?: string;
	secFetchSite?: string;
	/** Public API/editor URL used by new callers. */
	managementUrl?: string;
	/** Legacy test/caller alias retained while the contract migrates. */
	frontendUrl?: string;
}

function isPreviewManagementPath(path: string): boolean {
	return (
		path === "/api/v1/preview-session" ||
		path.startsWith("/api/v1/preview-session/")
	);
}

/**
 * Validate the browser-level CSRF boundary for preview-session mutations.
 *
 * The editor document is served by the API origin, which can differ from the
 * parent frontend origin in split deployments. Management requests must
 * therefore originate from the configured public API/editor origin. The
 * `frontendUrl` alias only preserves source compatibility for existing tests;
 * production registration always passes `managementUrl`.
 */
export function validatePreviewManagementRequest({
	method,
	path,
	origin,
	secFetchSite,
	managementUrl,
	frontendUrl,
}: PreviewManagementRequestMetadata): string | null {
	if (
		!isPreviewManagementPath(path) ||
		SAFE_METHODS.has(method.toUpperCase())
	) {
		return null;
	}

	let expectedOrigin: string;
	try {
		expectedOrigin = new URL(managementUrl ?? frontendUrl ?? "").origin;
	} catch {
		// managementUrl is PREVIEW_MANAGEMENT_ORIGIN / BETTER_AUTH_URL in production;
		// frontendUrl is only a legacy test alias. Message names the real boundary.
		return "Preview management is unavailable because the management origin is invalid";
	}

	if (!origin || origin !== expectedOrigin) {
		return "Preview management requires the configured same-origin management origin";
	}
	if (secFetchSite && secFetchSite !== "same-origin") {
		return "Preview management requires Sec-Fetch-Site: same-origin";
	}
	return null;
}

export function registerGlobalMiddleware(app: Hono<AuthEnv>) {
	const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
	// BETTER_AUTH_URL is the public API/auth origin in split deployments and
	// falls back to FRONTEND_URL in the unified topology. An explicit override is
	// available for reverse proxies that expose preview management elsewhere.
	const previewManagementUrl =
		process.env.PREVIEW_MANAGEMENT_ORIGIN ?? getAuthBaseUrl(process.env);

	// The app-wide CORS policy is credentialed and pinned to the frontend origin.
	// The authless preview SERVING route (`/api/v1/preview/{previewId}/*`) is
	// fetched by the opaque preview iframe with `Origin: null` and no credentials,
	// and sets its own `Access-Control-Allow-Origin: *`.
	const corsMiddleware = cors({
		origin: frontendUrl,
		credentials: true,
	});
	app.use("/api/*", (c, next) => {
		if (c.req.path.startsWith("/api/v1/preview/")) return next();
		return corsMiddleware(c, next);
	});
	app.use("/api/*", async (c, next) => {
		const error = validatePreviewManagementRequest({
			method: c.req.method,
			path: c.req.path,
			origin: c.req.header("Origin"),
			secFetchSite: c.req.header("Sec-Fetch-Site"),
			managementUrl: previewManagementUrl,
		});
		if (error) {
			return c.json({ success: false, error }, 403);
		}
		return next();
	});
	app.use("/api/*", auditMiddleware);
	app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

	for (const pattern of sessionProtectedApiPatterns) {
		app.use(pattern, sessionMiddleware);
	}

	for (const pattern of sessionProtectedSocialPatterns) {
		app.use(pattern, sessionMiddleware);
	}
}
