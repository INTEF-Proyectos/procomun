import type { Context, Hono, Next } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { tokenAuthMiddleware } from "../auth/token-auth.ts";
import { adminRoutes } from "../routes/admin/index.ts";
import { apiResourceRoutes } from "../routes/api-resources.ts";
import { apiTokenRoutes } from "../routes/api-tokens.ts";
import { devRoutes } from "../routes/dev.ts";
import { elpxContentRoutes } from "../routes/elpx-content.ts";
import { exelearningEditorRoutes } from "../routes/exelearning-editor.ts";
import { feedRoutes } from "../routes/feeds.ts";
import { previewRoutes, previewSessionRoutes } from "../routes/preview.ts";
import { publicRoutes } from "../routes/public.ts";
import { socialRoutes } from "../routes/social.ts";
import { uploadRoutes } from "../routes/uploads.ts";
import { getLimits as getPreviewLimits } from "../services/preview-snapshot-store.ts";

export const PREVIEW_MULTIPART_OVERHEAD_BYTES = 2 * 1024 * 1024;

export type PreviewMultipartLengthError = {
	status: 400 | 413;
	error: string;
};

export function previewMultipartMaxRequestBytes(
	maxBytesPerSnapshot: number = getPreviewLimits().maxBytesPerSnapshot,
): number {
	return maxBytesPerSnapshot + PREVIEW_MULTIPART_OVERHEAD_BYTES;
}

/** Validate Content-Length without consuming or materializing the body. */
export function validatePreviewMultipartContentLength(
	rawLength: string | undefined,
	maxRequestBytes: number = previewMultipartMaxRequestBytes(),
): PreviewMultipartLengthError | null {
	if (!rawLength) return null;

	const contentLength = Number(rawLength);
	if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
		return { status: 400, error: "Content-Length no válido" };
	}
	if (contentLength > maxRequestBytes) {
		return {
			status: 413,
			error: `La petición de previsualización supera el tamaño máximo (${maxRequestBytes} bytes)`,
		};
	}
	return null;
}

/**
 * Reject a known-oversized multipart request before Hono calls `formData()`.
 * Requests without Content-Length remain bounded by Bun's server-level
 * `maxRequestBodySize`; browser-generated FormData normally includes the header.
 */
async function previewMultipartBodyLimit(c: Context, next: Next) {
	if (c.req.method !== "POST") return next();
	const error = validatePreviewMultipartContentLength(
		c.req.header("content-length"),
	);
	if (error) return c.json({ error: error.error }, error.status);
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
