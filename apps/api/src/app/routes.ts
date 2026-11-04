import type { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { resolveOidcEndSessionUrl } from "../auth/oidc-discovery.ts";
import { tokenAuthMiddleware } from "../auth/token-auth.ts";
import { resolveEmailVerificationConfig } from "../email/transport.ts";
import { adminRoutes } from "../routes/admin/index.ts";
import { apiResourceRoutes } from "../routes/api-resources.ts";
import { apiTokenRoutes } from "../routes/api-tokens.ts";
import { devRoutes } from "../routes/dev.ts";
import { elpxContentRoutes } from "../routes/elpx-content.ts";
import { exelearningEditorRoutes } from "../routes/exelearning-editor.ts";
import { feedRoutes } from "../routes/feeds.ts";
import { keywordRoutes } from "../routes/keywords.ts";
import { publicRoutes } from "../routes/public.ts";
import { socialRoutes } from "../routes/social.ts";
import { tagRoutes } from "../routes/tags.ts";
import { thumbnailRoutes } from "../routes/thumbnails.ts";
import { uploadRoutes } from "../routes/uploads.ts";

export function registerRoutes(app: Hono<AuthEnv>) {
	app.get("/health", (c) => c.json({ status: "ok" }));
	app.get("/api/v1/config", async (c) =>
		c.json({
			oidcEnabled: process.env.OIDC_ENABLED === "true",
			emailVerificationRequired: resolveEmailVerificationConfig(process.env)
				.enabled,
			// #542: sale de end_session_endpoint del documento de descubrimiento,
			// no de la ruta de Duende. El acierto se guarda en caché.
			oidcEndSessionUrl: await resolveOidcEndSessionUrl(process.env),
		}),
	);

	app.route("/api/v1", publicRoutes);
	app.route("/api/v1/tags", tagRoutes);
	app.route("/api/v1/keywords", keywordRoutes);
	app.route("/api/v1", socialRoutes);
	app.route("/api/v1/elpx", elpxContentRoutes);
	app.route("/api/v1/thumbnails", thumbnailRoutes);
	app.route("/api/v1/exelearning-editor", exelearningEditorRoutes);
	app.route("/api/v1/tokens", apiTokenRoutes);
	app.use("/api/v1/publish/*", tokenAuthMiddleware);
	app.route("/api/v1/publish/resources", apiResourceRoutes);
	app.route("/api/admin", adminRoutes);
	app.route("/api/dev", devRoutes);
	app.route("/api/uploads", uploadRoutes);
	app.route("/feeds", feedRoutes);
}
