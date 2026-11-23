import { parseCatalogIdList } from "@procomun/db/knowledge-areas";
import * as repo from "@procomun/db/repository";
import { favorites, ratings, resources } from "@procomun/db/schema";
import { validateProfileUpdate } from "@procomun/db/user-profile";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { logActivity } from "../activity/log.ts";
import { type AuthEnv, requireAuth, requireUser } from "../auth/middleware.ts";
import { getDb } from "../db.ts";
import { parsePagination } from "../http/pagination.ts";
import { listUserActivity } from "../social/activity-service.ts";
import { getUserDashboardSummary } from "../social/dashboard-service.ts";
import { toggleResourceFavorite } from "../social/favorites-service.ts";
import {
	listMyResources,
	parseMyResourcesStatus,
} from "../social/my-resources-service.ts";
import {
	getResourceRatingsSummary,
	upsertResourceRating,
} from "../social/ratings-service.ts";
import { enrichResourceCards } from "../social/resource-card.ts";
import { resolveResourceBySlug } from "../social/resource-resolver.ts";
import {
	getResourceSocialStats,
	incrementDownload,
} from "../social/resource-stats-service.ts";
import {
	isValidViewSessionId,
	recordCollectionView,
	recordResourceView,
} from "../social/resource-views-service.ts";

const socialRoutes = new Hono<AuthEnv>();

// Note: sessionMiddleware is applied externally (in index.ts) so tests can mock auth.

// ---------------------------------------------------------------------------
// GET /resources/:slug/ratings
// ---------------------------------------------------------------------------
socialRoutes.get("/resources/:slug/ratings", async (c) => {
	const slug = c.req.param("slug");
	if (!slug) return c.json({ error: "Falta slug" }, 400);
	const resource = await resolveResourceBySlug(slug);
	if (!resource) {
		return c.json({ error: "Recurso no encontrado" }, 404);
	}

	const currentUser = c.get("user");
	const summary = await getResourceRatingsSummary(resource.id, currentUser?.id);
	return c.json({
		resourceId: resource.id,
		...summary,
	});
});

// ---------------------------------------------------------------------------
// POST /resources/:slug/ratings (auth required)
// ---------------------------------------------------------------------------
socialRoutes.post("/resources/:slug/ratings", requireAuth, async (c) => {
	const slug = c.req.param("slug");
	if (!slug) return c.json({ error: "Falta slug" }, 400);
	const currentUser = requireUser(c);
	const body = await c.req.json<{ score: number }>();

	if (
		!body.score ||
		body.score < 1 ||
		body.score > 5 ||
		!Number.isInteger(body.score)
	) {
		return c.json(
			{ error: "La puntuacion debe ser un entero entre 1 y 5" },
			400,
		);
	}

	const resource = await resolveResourceBySlug(slug);
	if (!resource) {
		return c.json({ error: "Recurso no encontrado" }, 404);
	}

	const result = await upsertResourceRating({
		resourceId: resource.id,
		userId: currentUser.id,
		score: body.score,
	});

	await logActivity({
		userId: currentUser.id,
		type: "rating_given",
		resourceId: resource.id,
		resourceTitle: resource.title,
		resourceSlug: resource.slug,
		description: `Valoraste «${resource.title}» con ${body.score} estrellas`,
		metadata: { score: body.score },
	});

	return c.json(result);
});

// ---------------------------------------------------------------------------
// POST /resources/:slug/favorite (auth required - toggle)
// ---------------------------------------------------------------------------
socialRoutes.post("/resources/:slug/favorite", requireAuth, async (c) => {
	const slug = c.req.param("slug");
	if (!slug) return c.json({ error: "Falta slug" }, 400);
	const currentUser = requireUser(c);

	const resource = await resolveResourceBySlug(slug);
	if (!resource) {
		return c.json({ error: "Recurso no encontrado" }, 404);
	}

	const result = await toggleResourceFavorite({
		resourceId: resource.id,
		userId: currentUser.id,
	});

	await logActivity({
		userId: currentUser.id,
		type: result.favorited ? "favorite_added" : "favorite_removed",
		resourceId: resource.id,
		resourceTitle: resource.title,
		resourceSlug: resource.slug,
		description: result.favorited
			? `Marcaste como favorito «${resource.title}»`
			: `Quitaste de favoritos «${resource.title}»`,
	});

	return c.json(result);
});

// ---------------------------------------------------------------------------
// GET /users/me/favorites (auth required)
// ---------------------------------------------------------------------------
socialRoutes.get("/users/me/favorites", requireAuth, async (c) => {
	const { limit, offset } = parsePagination(c);
	const currentUser = requireUser(c);
	const db = getDb().db;

	const rows = await db
		.select({
			id: resources.id,
			slug: resources.slug,
			title: resources.title,
			description: resources.description,
			language: resources.language,
			license: resources.license,
			resourceType: resources.resourceType,
			keywords: resources.keywords,
			author: resources.author,
			publisher: resources.publisher,
			editorialStatus: resources.editorialStatus,
			createdBy: resources.createdBy,
			createdAt: resources.createdAt,
			updatedAt: resources.updatedAt,
			favoritedAt: favorites.createdAt,
		})
		.from(favorites)
		.innerJoin(resources, eq(favorites.resourceId, resources.id))
		.where(
			and(eq(favorites.userId, currentUser.id), isNull(resources.deletedAt)),
		)
		.orderBy(desc(favorites.createdAt))
		.limit(limit)
		.offset(offset);

	const countResult = await db
		.select({ count: sql<number>`count(*)` })
		.from(favorites)
		.innerJoin(resources, eq(favorites.resourceId, resources.id))
		.where(
			and(eq(favorites.userId, currentUser.id), isNull(resources.deletedAt)),
		);

	const enriched = await enrichResourceCards(rows, currentUser);
	return c.json({
		data: enriched,
		total: Number(countResult[0]?.count ?? 0),
		limit,
		offset,
	});
});

// ---------------------------------------------------------------------------
// GET /users/me/ratings (auth required)
// ---------------------------------------------------------------------------
socialRoutes.get("/users/me/ratings", requireAuth, async (c) => {
	const { limit, offset } = parsePagination(c);
	const currentUser = requireUser(c);
	const db = getDb().db;

	const rows = await db
		.select({
			id: resources.id,
			slug: resources.slug,
			title: resources.title,
			description: resources.description,
			language: resources.language,
			license: resources.license,
			resourceType: resources.resourceType,
			author: resources.author,
			editorialStatus: resources.editorialStatus,
			// Para decidir si quien valoró puede ver un recurso ya no publicado.
			createdBy: resources.createdBy,
			createdAt: resources.createdAt,
			userScore: ratings.score,
			ratedAt: ratings.createdAt,
		})
		.from(ratings)
		.innerJoin(resources, eq(ratings.resourceId, resources.id))
		.where(and(eq(ratings.userId, currentUser.id), isNull(resources.deletedAt)))
		.orderBy(desc(ratings.createdAt))
		.limit(limit)
		.offset(offset);

	const countResult = await db
		.select({ count: sql<number>`count(*)` })
		.from(ratings)
		.innerJoin(resources, eq(ratings.resourceId, resources.id))
		.where(
			and(eq(ratings.userId, currentUser.id), isNull(resources.deletedAt)),
		);

	const enrichedRatings = await enrichResourceCards(rows, currentUser);
	return c.json({
		data: enrichedRatings,
		total: Number(countResult[0]?.count ?? 0),
		limit,
		offset,
	});
});

// ---------------------------------------------------------------------------
// GET /users/me/dashboard (auth required)
// ---------------------------------------------------------------------------
socialRoutes.get("/users/me/dashboard", requireAuth, async (c) => {
	const currentUser = requireUser(c);
	return c.json(await getUserDashboardSummary(currentUser.id));
});

// ---------------------------------------------------------------------------
// GET /users/me/resources (auth required) — «Mis recursos» (#530)
// Todos los recursos propios en cualquier estado, con los filtros del buscador.
// ---------------------------------------------------------------------------
socialRoutes.get("/users/me/resources", requireAuth, async (c) => {
	const { limit, offset, search } = parsePagination(c);
	const currentUser = requireUser(c);
	const status = parseMyResourcesStatus(c.req.query("status"));
	if (!status.ok) return c.json({ error: "Estado no válido" }, 400);
	return c.json(
		await listMyResources(currentUser.id, {
			limit,
			offset,
			search,
			status: status.status,
			resourceType: c.req.query("resourceType"),
			tag: c.req.query("tag"),
			educationalCategory: c.req.query("educationalCategory"),
			educationalOption: c.req.query("educationalOption"),
			knowledgeAreaIds: parseCatalogIdList(c.req.query("knowledgeAreas")),
			professionalFamilyIds: parseCatalogIdList(
				c.req.query("professionalFamilies"),
			),
		}),
	);
});

// ---------------------------------------------------------------------------
// GET /users/me/profile (auth required)
// ---------------------------------------------------------------------------
// `profile` lleva centro, localidad y redes (#533). Es privado: solo se
// devuelve aquí, a su dueño, hasta que #504 decida qué se muestra.
socialRoutes.get("/users/me/profile", requireAuth, async (c) => {
	const currentUser = requireUser(c);
	const db = getDb().db;
	const [found, profile, bio] = await Promise.all([
		repo.getUserById(db, currentUser.id),
		repo.getUserProfileDetails(db, currentUser.id),
		// Su dueño ve también el «Sobre mí» importado sin editar (#586).
		repo.getUserAbout(db, currentUser.id),
	]);

	if (found) return c.json({ ...found, bio, profile });

	return c.json({
		id: currentUser.id,
		email: currentUser.email ?? "",
		name: currentUser.name ?? null,
		bio: null,
		role: currentUser.role ?? "reader",
		isActive: true,
		profile,
	});
});

// ---------------------------------------------------------------------------
// PATCH /users/me/profile (auth required)
// ---------------------------------------------------------------------------
socialRoutes.patch("/users/me/profile", requireAuth, async (c) => {
	const currentUser = requireUser(c);
	await repo.ensureUser(getDb().db, {
		id: currentUser.id,
		email: currentUser.email ?? `${currentUser.id}@local.invalid`,
		name: currentUser.name ?? null,
		role: currentUser.role ?? "reader",
	});

	const body = await c.req.json().catch(() => null);
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return c.json({ error: "Cuerpo de la petición inválido" }, 400);
	}

	// #533: el nombre no puede quedar vacío y los textos tienen longitud máxima.
	const validation = validateProfileUpdate(body);
	if (!validation.ok) {
		return c.json(
			{ error: "Datos inválidos", details: validation.errors },
			400,
		);
	}
	// Todo o nada: un fallo al final no deja el nombre cambiado y el resto no.
	await repo.updateOwnProfile(getDb().db, currentUser.id, validation.value);
	return c.json({ id: currentUser.id, updated: true });
});

// ---------------------------------------------------------------------------
// GET /users/me/activity (auth required)
// ---------------------------------------------------------------------------
socialRoutes.get("/users/me/activity", requireAuth, async (c) => {
	const { limit, offset } = parsePagination(c);
	const currentUser = requireUser(c);
	return c.json(
		await listUserActivity({
			userId: currentUser.id,
			limit,
			offset,
		}),
	);
});

// ---------------------------------------------------------------------------
// POST /resources/:slug/download (log download event)
// ---------------------------------------------------------------------------
socialRoutes.post("/resources/:slug/download", async (c) => {
	const slug = c.req.param("slug");
	if (!slug) return c.json({ error: "Falta slug" }, 400);

	const resource = await resolveResourceBySlug(slug);
	if (!resource) {
		return c.json({ error: "Recurso no encontrado" }, 404);
	}

	let format = "direct";
	try {
		const body = await c.req.json<{ format?: string }>();
		if (body && typeof body.format === "string") {
			const allowed = ["direct", "scorm", "ims", "web", "epub"];
			if (allowed.includes(body.format)) {
				format = body.format;
			}
		}
	} catch {
		// No body or invalid JSON — default to "direct"
	}

	const currentUser = c.get("user") as { id: string } | undefined;
	const count = await incrementDownload(resource.id, currentUser?.id, format);

	if (currentUser?.id) {
		await logActivity({
			userId: currentUser.id,
			type: "resource_downloaded",
			resourceId: resource.id,
			resourceTitle: resource.title,
			resourceSlug: resource.slug,
			description: `Descargaste «${resource.title}»`,
		});
	}

	return c.json({ count });
});

// ---------------------------------------------------------------------------
// POST /resources/:slug/view (una visita por sesión al abrir la vista previa,
// ADR-0044). Solo recursos publicados: resolveResourceBySlug ya los filtra.
// ---------------------------------------------------------------------------
socialRoutes.post("/resources/:slug/view", async (c) => {
	const slug = c.req.param("slug");
	if (!slug) return c.json({ error: "Falta slug" }, 400);

	const body = await c.req
		.json<{ sessionId?: unknown }>()
		.catch(() => ({ sessionId: undefined }));
	if (!isValidViewSessionId(body.sessionId)) {
		return c.json({ error: "Identificador de sesión no válido" }, 400);
	}

	const resource = await resolveResourceBySlug(slug);
	if (!resource) {
		return c.json({ error: "Recurso no encontrado" }, 404);
	}

	const viewCount = await recordResourceView(resource.id, body.sessionId);
	return c.json({ viewCount });
});

socialRoutes.post("/collections/:slug/view", async (c) => {
	const body = await c.req.json<{ sessionId?: unknown }>().catch(() => null);
	if (!isValidViewSessionId(body?.sessionId)) {
		return c.json({ error: "Identificador de sesión no válido" }, 400);
	}

	const viewCount = await recordCollectionView(
		c.req.param("slug"),
		body.sessionId,
	);
	if (viewCount === null) {
		return c.json({ error: "Colección no encontrada" }, 404);
	}
	return c.json({ viewCount });
});

// ---------------------------------------------------------------------------
// GET /resources/:slug/stats (aggregated social stats)
// ---------------------------------------------------------------------------
socialRoutes.get("/resources/:slug/stats", async (c) => {
	const slug = c.req.param("slug");
	if (!slug) return c.json({ error: "Falta slug" }, 400);

	const resource = await resolveResourceBySlug(slug);
	if (!resource) {
		return c.json({ error: "Recurso no encontrado" }, 404);
	}

	const currentUser = c.get("user");
	return c.json(await getResourceSocialStats(resource.id, currentUser?.id));
});

type ReportBody = { reason: repo.ReportReason; description: string | null };

/** Valida el cuerpo de una denuncia; igual para recursos y colecciones. */
async function parseReportBody(
	c: Context<AuthEnv>,
): Promise<ReportBody | { error: string }> {
	const body = await c.req
		.json<{ reason?: unknown; description?: unknown }>()
		.catch(() => null);
	if (
		!body ||
		typeof body.reason !== "string" ||
		!repo.REPORT_REASONS.includes(body.reason as repo.ReportReason)
	) {
		return {
			error: `Motivo inválido. Válidos: ${repo.REPORT_REASONS.join(", ")}`,
		};
	}
	// Sanitize description: trim and limit length
	const description =
		typeof body.description === "string" && body.description.trim()
			? body.description.trim().slice(0, 2000)
			: null;
	return { reason: body.reason as repo.ReportReason, description };
}

// ---------------------------------------------------------------------------
// POST /resources/:slug/report (auth required — submit content report)
// ---------------------------------------------------------------------------
socialRoutes.post("/resources/:slug/report", requireAuth, async (c) => {
	const slug = c.req.param("slug");
	if (!slug) return c.json({ error: "Falta slug" }, 400);
	const currentUser = requireUser(c);

	const resource = await resolveResourceBySlug(slug);
	if (!resource) {
		return c.json({ error: "Recurso no encontrado" }, 404);
	}

	const body = await parseReportBody(c);
	if ("error" in body) return c.json({ error: body.error }, 400);

	const result = await repo.createReport(getDb().db, {
		resourceId: resource.id,
		reporterId: currentUser.id,
		reason: body.reason,
		description: body.description,
	});

	await logActivity({
		userId: currentUser.id,
		type: "report_submitted",
		resourceId: resource.id,
		resourceTitle: resource.title,
		resourceSlug: resource.slug,
		description: `Reportaste «${resource.title}» por ${body.reason}`,
		metadata: { reason: body.reason },
	});

	return c.json(result, 201);
});

// ---------------------------------------------------------------------------
// POST /collections/:slug/report (issue #539: auth required, solo publicadas)
// ---------------------------------------------------------------------------
socialRoutes.post("/collections/:slug/report", requireAuth, async (c) => {
	const slug = c.req.param("slug");
	if (!slug) return c.json({ error: "Falta slug" }, 400);
	const currentUser = requireUser(c);

	// Solo se denuncia lo que se ve: una colección publicada.
	const collection = await repo.getCollectionBySlug(getDb().db, slug, {
		status: "published",
	});
	if (!collection) {
		return c.json({ error: "Colección no encontrada" }, 404);
	}

	const body = await parseReportBody(c);
	if ("error" in body) return c.json({ error: body.error }, 400);

	const result = await repo.createReport(getDb().db, {
		collectionId: collection.id,
		reporterId: currentUser.id,
		reason: body.reason,
		description: body.description,
	});

	await logActivity({
		userId: currentUser.id,
		type: "report_submitted",
		description: `Reportaste la colección «${collection.title}» por ${body.reason}`,
		metadata: {
			reason: body.reason,
			collectionId: collection.id,
			collectionSlug: collection.slug,
		},
	});

	return c.json(result, 201);
});

export { socialRoutes };
