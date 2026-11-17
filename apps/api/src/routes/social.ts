import * as repo from "@procomun/db/repository";
import { favorites, ratings, resources } from "@procomun/db/schema";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { logActivity } from "../activity/log.ts";
import { type AuthEnv, requireAuth, requireUser } from "../auth/middleware.ts";
import { getDb } from "../db.ts";
import { parsePagination } from "../http/pagination.ts";
import { listUserActivity } from "../social/activity-service.ts";
import { getUserDashboardSummary } from "../social/dashboard-service.ts";
import { toggleResourceFavorite } from "../social/favorites-service.ts";
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
			// Sello «Validado» (#420) para la tarjeta.
			validatedAt: resources.validatedAt,
			validationSource: resources.validationSource,
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
// GET /users/me/profile (auth required)
// ---------------------------------------------------------------------------
socialRoutes.get("/users/me/profile", requireAuth, async (c) => {
	const currentUser = requireUser(c);
	const found = await repo.getUserById(getDb().db, currentUser.id);

	if (found) return c.json(found);

	return c.json({
		id: currentUser.id,
		email: currentUser.email ?? "",
		name: currentUser.name ?? null,
		bio: null,
		role: currentUser.role ?? "reader",
		isActive: true,
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
	if (!body || typeof body !== "object") {
		return c.json({ error: "Cuerpo de la petición inválido" }, 400);
	}

	const updates: { name?: string | null; bio?: string | null } = {};
	if ("name" in body)
		updates.name = typeof body.name === "string" ? body.name : null;
	if ("bio" in body)
		updates.bio = typeof body.bio === "string" ? body.bio : null;

	await repo.updateUser(getDb().db, currentUser.id, updates);
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

	const body = await c.req.json<{ reason: string; description?: string }>();

	if (
		!body.reason ||
		!repo.REPORT_REASONS.includes(body.reason as repo.ReportReason)
	) {
		return c.json(
			{ error: `Motivo inválido. Válidos: ${repo.REPORT_REASONS.join(", ")}` },
			400,
		);
	}

	// Sanitize description: trim and limit length
	const description = body.description
		? body.description.trim().slice(0, 2000)
		: null;

	const result = await repo.createReport(getDb().db, {
		resourceId: resource.id,
		reporterId: currentUser.id,
		reason: body.reason as repo.ReportReason,
		description,
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

export { socialRoutes };
