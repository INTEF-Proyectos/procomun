import { downloads, favorites, ratings } from "@procomun/db/schema";
import { eq, sql } from "drizzle-orm";
import { getDb } from "../db.ts";
import { getUserFavoriteState } from "./favorites-service.ts";
import { roundRatingAverage } from "./resource-card.ts";

export async function incrementDownload(
	resourceId: string,
	userId?: string,
	format = "direct",
) {
	const db = getDb().db;
	await db.insert(downloads).values({
		id: crypto.randomUUID(),
		resourceId,
		userId: userId ?? null,
		format,
		createdAt: new Date(),
	});

	const countResult = await db
		.select({ count: sql<number>`count(*)` })
		.from(downloads)
		.where(eq(downloads.resourceId, resourceId));

	return Number(countResult[0]?.count ?? 0);
}

export async function getResourceSocialStats(
	resourceId: string,
	userId?: string,
) {
	const db = getDb().db;
	const [dlResult, dlGroupResult, favResult, ratingResult, userFavorited] =
		await Promise.all([
			db
				.select({ count: sql<number>`count(*)` })
				.from(downloads)
				.where(eq(downloads.resourceId, resourceId)),
			db
				.select({
					format: downloads.format,
					count: sql<number>`count(*)`,
				})
				.from(downloads)
				.where(eq(downloads.resourceId, resourceId))
				.groupBy(downloads.format),
			db
				.select({ count: sql<number>`count(*)` })
				.from(favorites)
				.where(eq(favorites.resourceId, resourceId)),
			db
				.select({
					avg: sql<number>`coalesce(avg(${ratings.score}), 0)`,
					count: sql<number>`count(*)`,
				})
				.from(ratings)
				.where(eq(ratings.resourceId, resourceId)),
			getUserFavoriteState(resourceId, userId),
		]);

	const exportCounts = {
		scorm: 0,
		ims: 0,
		web: 0,
		epub: 0,
	};

	for (const row of dlGroupResult) {
		const fmt = row.format;
		if (fmt === "scorm" || fmt === "ims" || fmt === "web" || fmt === "epub") {
			exportCounts[fmt] = Number(row.count ?? 0);
		}
	}

	return {
		downloadCount: Number(dlResult[0]?.count ?? 0),
		exportCounts,
		favoriteCount: Number(favResult[0]?.count ?? 0),
		ratingAvg: roundRatingAverage(ratingResult[0]?.avg ?? 0),
		ratingCount: Number(ratingResult[0]?.count ?? 0),
		userFavorited,
	};
}
