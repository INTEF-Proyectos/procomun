import * as repo from "@procomun/db/repository";
import { favorites, ratings } from "@procomun/db/schema";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db.ts";

/**
 * Resumen del perfil. «Mis recursos» ya no va aquí (eran los 5 últimos): tiene
 * su propio listado paginado en GET /users/me/resources (#530).
 */
export async function getUserDashboardSummary(userId: string) {
	const db = getDb().db;
	const [statusCounts, favResult, ratingCountResult] = await Promise.all([
		// #530: los cuatro estados con las mismas condiciones que «Mis recursos».
		repo.countResourcesByStatus(db, { createdBy: userId }),
		db
			.select({ count: sql<number>`count(*)` })
			.from(favorites)
			.where(eq(favorites.userId, userId)),
		db
			.select({ count: sql<number>`count(*)` })
			.from(ratings)
			.where(eq(ratings.userId, userId)),
	]);

	return {
		draftCount: statusCounts.draft,
		reviewCount: statusCounts.review,
		publishedCount: statusCounts.published,
		archivedCount: statusCounts.archived,
		resourceCount: statusCounts.total,
		favoriteCount: Number(favResult[0]?.count ?? 0),
		ratingCount: Number(ratingCountResult[0]?.count ?? 0),
	};
}
