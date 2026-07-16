import type { Context, Hono, Next } from "hono";
import { type AuthEnv } from "../auth/middleware.ts";
import { tokenAuthMiddleware } from "../auth/token-auth.ts";
import { adminRoutes } from "../routes/admin/index.ts";
import { devRoutes } from "../routes/dev.ts";
import { elpxContentRoutes } from "../routes/elpx-content.ts";
import { exelearningEditorRoutes } from "../routes/exelearning-editor.ts";
import { feedRoutes } from "../routes/feeds.ts";
import { previewRoutes, previewSessionRoutes } from "../routes/preview.ts";
import { publicRoutes } from "../routes/public.ts";
import { socialRoutes } from "../routes/social.ts";
import { uploadRoutes } from "../routes/uploads.ts";
import { apiResourceRoutes } from "../routes/api-resources.ts";
import { apiTokenRoutes } from "../routes/api-tokens.ts";
import { getLimits as getPreviewLimits } from "../services/preview-session-store.ts";

const PREVIEW_MULTIPART_OVERHEAD_BYTES = 2 * 1024 * 1024;

/**
 * Reject a known-oversized multipart request before Hono calls `formData()`.
 * Requests without Content-Length remain bounded by Bun's server-level
 * `maxRequestBodySize`; browser-generated FormData normally includes the header.
 */
async function previewMultipartBodyLimit(c: Context, next: Next) {
	if (c.req.method !== "POST") return next();
	const rawLength = c.req.header("content-length");
	if (rawLength) {
		const contentLength = Number(rawLength);
		if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
			return c.json({ error: "Content-Length no válido" }, 400);
		}
		const maxRequestBytes =
			getPreviewLimits().maxBytesPerSession + PREVIEW_MULTIPART_OVERHEAD_BYTES;
		if (contentLength > maxRequestBytes) {
			return c.json(
				{
					error: `La petición de previsualización supera el tamaño máximo (${maxRequestBytes} bytes)`,
				},
				413,
			);
		}
	}
	return next();
}

export function registerRoutes(app: Hono<AuthEnv>) {
	app.get("/health", (c) => c.json({ status: "ok" }));
	app.get("/api/v1/config", (c) =>
		c.json({
			oidcEnabled: process.env.OIDC_ENABLED === "true",
			oidcEndSessionUrl: process.env.OIDC_ISSUER
				? `${process.env.OIDC_ISSUER}/connect/endsession`
				: null,
		}),
	);

	app.route("/api/v1", publicRoutes);
	app.route("/api/v1", socialRoutes);
	app.route("/api/v1/elpx", elpxContentRoutes);
	// Bound raw multipart bodies before the management router materializes them.
	app.use(
		"/api/v1/preview-session/:previewId/assets",
		previewMultipartBodyLimit,
	);
	app.use(
		"/api/v1/preview-session/:previewId/revisions",
		previewMultipartBodyLimit,
	);
	// Authenticated preview-session management API (owner-gated) + the authless,
	// capability-URL serving route for the opaque preview iframe.
	app.route("/api/v1/preview-session", previewSessionRoutes);
	app.route("/api/v1/preview", previewRoutes);
	app.route("/api/v1/exelearning-editor", exelearningEditorRoutes);
	app.route("/api/v1/tokens", apiTokenRoutes);
	app.use("/api/v1/publish/*", tokenAuthMiddleware);
	app.route("/api/v1/publish/resources", apiResourceRoutes);
	app.route("/api/admin", adminRoutes);
	app.route("/api/dev", devRoutes);
	app.route("/api/uploads", uploadRoutes);
	app.route("/feeds", feedRoutes);
}
