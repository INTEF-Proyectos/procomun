import { parseCatalogIdList } from "@procomun/db/knowledge-areas";
import * as repo from "@procomun/db/repository";
import { user } from "@procomun/db/schema";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../db.ts";
import { buildElpxPreview } from "../elpx/preview.ts";
import { searchResources } from "../fts/search.ts";
import { parsePagination } from "../http/pagination.ts";
import { canViewResource, getSessionUser } from "../public/access.ts";
import {
	listPublishedCollectionResources,
	listPublishedCollections,
	listPublishedResources,
} from "../public/service.ts";
import { getRelatedResourcesBySlug } from "../recommendations/service.ts";
import { thumbnailUrlForStatus } from "../thumbnails/access.ts";
import { contentDisposition } from "../uploads/config.ts";
import { readUploadContent } from "./uploads.ts";

const publicRoutes = new Hono();

publicRoutes.get("/resources", async (c) => {
	const { limit, offset, search } = parsePagination(c);
	const resourceType = c.req.query("resourceType") ?? undefined;
	const language = c.req.query("language") ?? undefined;
	const license = c.req.query("license") ?? undefined;
	const tag = c.req.query("tag") ?? undefined;
	const educationalCategory = c.req.query("educationalCategory") ?? undefined;
	const educationalOption = c.req.query("educationalOption") ?? undefined;
	// #448: ids separados por comas; dentro de cada filtro vale cualquiera.
	const knowledgeAreas = parseCatalogIdList(c.req.query("knowledgeAreas"));
	const professionalFamilies = parseCatalogIdList(
		c.req.query("professionalFamilies"),
	);
	return c.json(
		await listPublishedResources({
			limit,
			offset,
			search,
			resourceType,
			language,
			license,
			tag,
			educationalCategory,
			educationalOption,
			knowledgeAreas,
			professionalFamilies,
		}),
	);
});

// More specific than /resources/:slug — related recommendations (ADR-0036 / #72).
publicRoutes.get("/resources/:slug/related", async (c) => {
	const slug = c.req.param("slug");
	if (!slug) return c.json({ error: "Falta slug" }, 400);

	const resource = await repo.getResourceBySlug(getDb().db, slug);
	if (!resource) {
		return c.json({ error: "Recurso no encontrado" }, 404);
	}

	const currentUser = await getSessionUser(c);
	if (!canViewResource(currentUser, resource)) {
		return c.json({ error: "Recurso no encontrado" }, 404);
	}

	const related = await getRelatedResourcesBySlug(
		getDb().db,
		slug,
		c.req.query("limit"),
	);
	if (!related) {
		return c.json({ error: "Recurso no encontrado" }, 404);
	}

	return c.json(related);
});

publicRoutes.get("/resources/:slug", async (c) => {
	const slug = c.req.param("slug");
	if (!slug) return c.json({ error: "Falta slug" }, 400);
	const resource = await repo.getResourceBySlug(getDb().db, slug);
	if (!resource) {
		return c.json({ error: "Recurso no encontrado" }, 404);
	}

	const currentUser = await getSessionUser(c);
	if (!canViewResource(currentUser, resource)) {
		return c.json({ error: "Recurso no encontrado" }, 404);
	}

	// Versionado (issue #31): la ficha pública sirve la versión vigente, no la
	// copia de trabajo del autor.
	const elpx = await repo.getCurrentElpxProjectByResourceId(
		getDb().db,
		resource.id,
	);
	let elpxFileUrl: string | null = null;
	if (elpx?.uploadSessionId) {
		elpxFileUrl = `/api/v1/uploads/${elpx.uploadSessionId}/content`;
	} else {
		const elpxMedia = resource.mediaItems?.find(
			(mediaItem) =>
				mediaItem.filename?.endsWith(".elpx") ||
				mediaItem.filename?.endsWith(".elp"),
		);
		if (elpxMedia) elpxFileUrl = elpxMedia.url;
	}

	return c.json({
		...resource,
		// Revisión de #481: la preview legacy de un recurso no publicado solo
		// sale firmada, igual que la miniatura del paquete.
		thumbnailUrl: thumbnailUrlForStatus(
			resource.thumbnailUrl,
			resource.editorialStatus,
		),
		elpxPreview: buildElpxPreview(elpx, resource.editorialStatus),
		elpxFileUrl,
	});
});

// Ficha pública de quien publica (#458): nombre, foto y sus recursos
// publicados (sin borradores ni eliminados), del más reciente al más antiguo.
publicRoutes.get("/authors/:id", async (c) => {
	const id = c.req.param("id");
	const author = await repo.getPublicAuthor(getDb().db, id);
	if (!author) return c.json({ error: "Ficha no encontrada" }, 404);
	const { limit, offset } = parsePagination(c);
	const resources = await listPublishedResources({
		limit,
		offset,
		createdBy: author.id,
		includeUnvalidated: true,
	});
	return c.json({ ...resources, author });
});

publicRoutes.get("/uploads/:id/content", async (c) => {
	const { id } = c.req.param();
	const session = await repo.getUploadSessionById(getDb().db, id);
	if (session?.status !== "completed") {
		return c.json({ error: "Archivo no encontrado" }, 404);
	}
	// Sin media item la sesión solo es descargable si su .elpx forma parte del
	// historial de versiones (issue #31): al reemplazar un archivo, el media item
	// se borra pero la entrega publicada debe seguir descargable.
	// RF-008 / issue #323: solo la versión vigente se expone en la API pública.
	const referencedByVersions = await repo.isUploadSessionReferencedByVersions(
		getDb().db,
		id,
	);
	if (referencedByVersions) {
		if (!(await repo.isUploadSessionOfCurrentVersion(getDb().db, id))) {
			return c.json({ error: "Archivo no encontrado" }, 404);
		}
	} else if (!session.mediaItemId) {
		return c.json({ error: "Archivo no encontrado" }, 404);
	}

	const resource = await repo.getResourceById(getDb().db, session.resourceId);
	if (resource?.editorialStatus !== "published") {
		return c.json({ error: "Archivo no encontrado" }, 404);
	}

	const body = await readUploadContent(id).catch(() => null);
	if (!body) {
		return c.json({ error: "Archivo no encontrado" }, 404);
	}

	return new Response(body, {
		status: 200,
		headers: {
			"Content-Type": session.mimeType ?? "application/octet-stream",
			"Content-Disposition": contentDisposition(
				"attachment",
				session.originalFilename,
			),
		},
	});
});

publicRoutes.get("/taxonomies/:type", async (c) => {
	const { type } = c.req.param();
	const result = await repo.listTaxonomies(getDb().db, { type, limit: 100 });
	return c.json(result.data);
});

publicRoutes.get("/collections", async (c) => {
	const { limit, offset, search } = parsePagination(c);
	return c.json(await listPublishedCollections({ limit, offset, search }));
});

publicRoutes.get("/collections/:slug", async (c) => {
	const { slug } = c.req.param();
	const collection = await repo.getCollectionBySlug(getDb().db, slug, {
		status: "published",
		resourceStatus: "published",
	});
	if (!collection) {
		return c.json({ error: "Colección no encontrada" }, 404);
	}

	return c.json({
		...collection,
		resources: await listPublishedCollectionResources(collection.id),
	});
});

publicRoutes.get("/config/badges", async (c) => {
	const settings = await repo.getAllSettings(getDb().db);
	return c.json({
		novedadDays: Number(settings.badge_novedad_days ?? "30"),
		destacadoMinRatings: Number(settings.badge_destacado_min_ratings ?? "3"),
		destacadoMinAvg: Number(settings.badge_destacado_min_avg ?? "4.0"),
		destacadoMinFavorites: Number(
			settings.badge_destacado_min_favorites ?? "3",
		),
	});
});

publicRoutes.get("/search", async (c) => {
	const query = c.req.query("q") ?? "";
	if (!query.trim()) {
		return c.json({ data: [], total: 0 });
	}
	const { limit, offset } = parsePagination(c);
	const language = c.req.query("language") ?? "es";

	const result = await searchResources(getDb().db, {
		query,
		limit,
		offset,
		language,
		status: "published",
		validatedOnly: true,
	});

	return c.json(result);
});

publicRoutes.get("/stats", async (c) => {
	const db = getDb().db;
	const [userCount] = await db
		.select({ count: sql<number>`count(*)` })
		.from(user);
	return c.json({
		users: Number(userCount?.count ?? 0),
	});
});

export { publicRoutes };
