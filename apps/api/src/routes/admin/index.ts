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
import { keywordAdminRoutes } from "./keywords.ts";
import { knowledgeAreaAdminRoutes } from "./knowledge-areas.ts";
import { reportRoutes } from "./reports.ts";
import { adminUploadRoutes, resourceRoutes } from "./resources.ts";
import { settingsRoutes } from "./settings.ts";
import { tagAdminRoutes } from "./tags.ts";
import { taxonomyRoutes } from "./taxonomies.ts";
import { userRoutes } from "./users.ts";

const adminRoutes = new Hono<AuthEnv>();

adminRoutes.use("*", requireAuth);
// Piso mínimo del backoffice: creadores de contenido (author+). Bloquea a reader.
// Las secciones de recursos/subidas/elpx se sirven a author+ (DEF-221); el resto
// eleva el requisito a curator o admin con gates explícitos por sección, como
// defensa adicional al control de acceso interno de cada sub-router.
adminRoutes.use("*", requireRole("author"));

// #432: author+ para que el autor de un itinerario importado gestione su
// colección. collectionRoutes deja crear y borrar solo al curator y
// canManageCollection limita el resto a las suyas.
adminRoutes.use("/collections", requireRole("author"));
adminRoutes.use("/collections/*", requireRole("author"));
adminRoutes.use("/taxonomies", requireRole("curator"));
adminRoutes.use("/taxonomies/*", requireRole("curator"));
// Alta en el catálogo de palabras clave (ADR-0042)
adminRoutes.use("/keywords", requireRole("curator"));
adminRoutes.use("/keywords/*", requireRole("curator"));
// Catálogo de áreas de conocimiento (ADR-0045)
adminRoutes.use("/knowledge-areas", requireRole("curator"));
adminRoutes.use("/knowledge-areas/*", requireRole("curator"));
// Tag management (merge/edit/delete) is curator+; resource tag attach is author+
// and enforced inside tagAdminRoutes for /resources/:id
adminRoutes.use("/tags", requireRole("author"));
adminRoutes.use("/tags/*", requireRole("author"));
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
adminRoutes.route("/tags", tagAdminRoutes);
adminRoutes.route("/keywords", keywordAdminRoutes);
adminRoutes.route("/knowledge-areas", knowledgeAreaAdminRoutes);
adminRoutes.route("/uploads", adminUploadRoutes);
adminRoutes.route("/elpx", elpxAdminRoutes);
adminRoutes.route("/settings", settingsRoutes);
adminRoutes.route("/reports", reportRoutes);
adminRoutes.route("/fts", ftsRoutes);
adminRoutes.route("/api-tokens", adminApiTokensRoutes);

export { adminRoutes };
