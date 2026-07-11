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

export function registerGlobalMiddleware(app: Hono<AuthEnv>) {
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
		origin: process.env.FRONTEND_URL ?? "http://localhost:5173",
		credentials: true,
	});
	app.use("/api/*", (c, next) => {
		if (c.req.path.startsWith("/api/v1/preview/")) return next();
		return corsMiddleware(c, next);
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
