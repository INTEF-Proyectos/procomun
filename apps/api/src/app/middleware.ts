import { cors } from "hono/cors";
import type { Hono } from "hono";
import { auditMiddleware } from "../auth/audit.ts";
import { auth } from "../auth/config.ts";
import { type AuthEnv, sessionMiddleware } from "../auth/middleware.ts";

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
	frontendUrl: string;
}

function isPreviewManagementPath(path: string): boolean {
	return path === "/api/v1/preview-session" || path.startsWith("/api/v1/preview-session/");
}

/**
 * Validate the browser-level CSRF boundary for preview-session mutations.
 *
 * SameSite=Lax remains useful defense in depth, but it is not the application
 * boundary: sibling subdomains are same-site while still being foreign origins.
 * Every unsafe preview-management request must therefore originate from the
 * exact configured frontend origin and, when Fetch Metadata is present, report
 * `same-origin`. The authless capability serving route is intentionally outside
 * this check.
 *
 * @returns An error message when the request must be rejected, otherwise null.
 */
export function validatePreviewManagementRequest({
	method,
	path,
	origin,
	secFetchSite,
	frontendUrl,
}: PreviewManagementRequestMetadata): string | null {
	if (!isPreviewManagementPath(path) || SAFE_METHODS.has(method.toUpperCase())) {
		return null;
	}

	let expectedOrigin: string;
	try {
		expectedOrigin = new URL(frontendUrl).origin;
	} catch {
		return "Preview management is unavailable because FRONTEND_URL is invalid";
	}

	if (!origin || origin !== expectedOrigin) {
		return "Preview management requires the configured same-origin frontend";
	}
	if (secFetchSite && secFetchSite !== "same-origin") {
		return "Preview management requires Sec-Fetch-Site: same-origin";
	}
	return null;
}

export function registerGlobalMiddleware(app: Hono<AuthEnv>) {
	const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
	// The app-wide CORS policy is credentialed and pinned to the frontend origin.
	// The authless preview SERVING route (`/api/v1/preview/{previewId}/*`) is
	// fetched by the opaque preview iframe with `Origin: null` and no credentials,
	// and sets its own `Access-Control-Allow-Origin: *` (never paired with
	// credentials). Running the credentialed policy over it would overwrite that
	// with the frontend origin and block those cross-origin subresource fetches
	// (fonts/media/range) from the null origin. So skip global CORS for the
	// serving route only — NOT for `/api/v1/preview-session/*` (management is
	// frontend-origin, credentialed).
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
			frontendUrl,
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
