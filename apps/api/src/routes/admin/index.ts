import { Hono } from "hono";
import {
	type AuthEnv,
	requireAuth,
	requireRole,
} from "../../auth/middleware.ts";
import { adminApiTokensRoutes } from "./api-tokens.ts";
import { collectionRoutes } from "./collections.ts";
import { elpxAdminRoutes } from "./elpx.ts";
import { ftsRoutes } from "./fts.ts";
import { reportRoutes } from "./reports.ts";
import { adminUploadRoutes, resourceRoutes } from "./resources.ts";
import { settingsRoutes } from "./settings.ts";
import { taxonomyRoutes } from "./taxonomies.ts";
import { userRoutes } from "./users.ts";

const adminRoutes = new Hono<AuthEnv>();

adminRoutes.use("*", requireAuth);
// Piso mínimo del backoffice: creadores de contenido (author+). Bloquea a reader.
// Las secciones de recursos/subidas/elpx se sirven a author+ (DEF-221); el resto
// eleva el requisito a curator o admin con gates explícitos por sección, como
// defensa adicional al control de acceso interno de cada sub-router.
adminRoutes.use("*", requireRole("author"));

adminRoutes.use("/collections", requireRole("curator"));
adminRoutes.use("/collections/*", requireRole("curator"));
adminRoutes.use("/taxonomies", requireRole("curator"));
adminRoutes.use("/taxonomies/*", requireRole("curator"));
adminRoutes.use("/reports", requireRole("curator"));
adminRoutes.use("/reports/*", requireRole("curator"));
adminRoutes.use("/users", requireRole("curator"));
adminRoutes.use("/users/*", requireRole("curator"));
adminRoutes.use("/settings", requireRole("admin"));
adminRoutes.use("/settings/*", requireRole("admin"));
adminRoutes.use("/fts", requireRole("admin"));
adminRoutes.use("/fts/*", requireRole("admin"));
adminRoutes.use("/api-tokens", requireRole("admin"));
adminRoutes.use("/api-tokens/*", requireRole("admin"));

adminRoutes.route("/resources", resourceRoutes);
adminRoutes.route("/users", userRoutes);
adminRoutes.route("/collections", collectionRoutes);
adminRoutes.route("/taxonomies", taxonomyRoutes);
adminRoutes.route("/uploads", adminUploadRoutes);
adminRoutes.route("/elpx", elpxAdminRoutes);
adminRoutes.route("/settings", settingsRoutes);
adminRoutes.route("/reports", reportRoutes);
adminRoutes.route("/fts", ftsRoutes);
adminRoutes.route("/api-tokens", adminApiTokensRoutes);

export { adminRoutes };
