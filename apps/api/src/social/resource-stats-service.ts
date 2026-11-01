import { downloads, favorites, ratings } from "@procomun/db/schema";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb } from "../db.ts";
import { getUserFavoriteState } from "./favorites-service.ts";
import { roundRatingAverage } from "./resource-card.ts";
import { getResourceViewCount } from "./resource-views-service.ts";

export async function incrementDownload(
	resourceId: string,
	userId?: string,
	format = "direct",
	options: { now?: Date; dedupWindowMs?: number } = {},
) {
	const db = getDb().db;
	const now = options.now ?? new Date();
	const configuredWindow = Number(process.env.DOWNLOAD_DEDUP_WINDOW_MS);
	const dedupWindowMs =
		options.dedupWindowMs ??
		(Number.isFinite(configuredWindow) && configuredWindow > 0
			? configuredWindow
			: 60_000);

	return db.transaction(async (tx: typeof db) => {
		const actor = userId ?? "anonymous";
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext(${`${resourceId}:${actor}:${format}`}))`,
		);
		const recent = await tx
			.select({ id: downloads.id })
			.from(downloads)
			.where(
				and(
					eq(downloads.resourceId, resourceId),
					eq(downloads.format, format),
					userId ? eq(downloads.userId, userId) : isNull(downloads.userId),
					gte(downloads.createdAt, new Date(now.getTime() - dedupWindowMs)),
				),
			)
			.limit(1);

		if (!recent[0]) {
			await tx.insert(downloads).values({
				id: crypto.randomUUID(),
				resourceId,
				userId: userId ?? null,
				format,
				createdAt: now,
			});
		}

		const countResult = await tx
			.select({ count: sql<number>`count(*)` })
			.from(downloads)
			.where(eq(downloads.resourceId, resourceId));

		return Number(countResult[0]?.count ?? 0);
	});
}

export async function getResourceSocialStats(
	resourceId: string,
	userId?: string,
) {
	const db = getDb().db;
	const [
		dlResult,
		dlGroupResult,
		favResult,
		ratingResult,
		userFavorited,
		viewCount,
	] = await Promise.all([
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
		getResourceViewCount(resourceId),
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
		viewCount,
	};
}
