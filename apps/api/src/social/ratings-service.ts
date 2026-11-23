import { collectionRatings, collections, ratings } from "@procomun/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db.ts";
import { roundRatingAverage } from "./resource-card.ts";

function publishedCollection(slug: string) {
	return and(
		eq(collections.slug, slug),
		eq(collections.editorialStatus, "published"),
	);
}

async function getRatingsSummary(
	table: typeof ratings | typeof collectionRatings,
	subject: ReturnType<typeof eq>,
	currentUserId?: string,
) {
	const db = getDb().db;
	const rows = await db
		.select({
			score: table.score,
			count: sql<number>`count(*)`,
		})
		.from(table)
		.where(subject)
		.groupBy(table.score);

	let totalRatings = 0;
	let totalScore = 0;
	const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
	for (const row of rows) {
		const count = Number(row.count);
		distribution[row.score] = count;
		totalRatings += count;
		totalScore += row.score * count;
	}

	let userScore: number | null = null;
	if (currentUserId) {
		const userRating = await db
			.select({ score: table.score })
			.from(table)
			.where(and(subject, eq(table.userId, currentUserId)))
			.limit(1);
		userScore = userRating[0]?.score ?? null;
	}

	return {
		averageScore:
			totalRatings > 0 ? roundRatingAverage(totalScore / totalRatings) : 0,
		totalRatings,
		distribution,
		userScore,
	};
}

export function getResourceRatingsSummary(
	resourceId: string,
	currentUserId?: string,
) {
	return getRatingsSummary(
		ratings,
		eq(ratings.resourceId, resourceId),
		currentUserId,
	);
}

export async function getCollectionRatingsSummary(
	slug: string,
	currentUserId?: string,
) {
	const [collection] = await getDb()
		.db.select({ id: collections.id })
		.from(collections)
		.where(publishedCollection(slug));
	if (!collection) return null;
	return {
		collectionId: collection.id,
		...(await getRatingsSummary(
			collectionRatings,
			eq(collectionRatings.collectionId, collection.id),
			currentUserId,
		)),
	};
}

export async function upsertCollectionRating(
	slug: string,
	userId: string,
	score: number,
) {
	const db = getDb().db;
	return db.transaction(async (tx: typeof db) => {
		const [collection] = await tx
			.select({ id: collections.id })
			.from(collections)
			.where(publishedCollection(slug))
			.for("share");
		if (!collection) return null;

		const [rating] = await tx
			.insert(collectionRatings)
			.values({ collectionId: collection.id, userId, score })
			.onConflictDoUpdate({
				target: [collectionRatings.collectionId, collectionRatings.userId],
				set: { score, updatedAt: new Date() },
			})
			.returning();
		return rating;
	});
}

export async function upsertResourceRating(input: {
	resourceId: string;
	userId: string;
	score: number;
}) {
	const db = getDb().db;
	const now = new Date();
	const existing = await db
		.select({ id: ratings.id })
		.from(ratings)
		.where(
			and(
				eq(ratings.resourceId, input.resourceId),
				eq(ratings.userId, input.userId),
			),
		)
		.limit(1);

	if (existing[0]) {
		await db
			.update(ratings)
			.set({ score: input.score, updatedAt: now })
			.where(eq(ratings.id, existing[0].id));
	} else {
		await db.insert(ratings).values({
			id: crypto.randomUUID(),
			resourceId: input.resourceId,
			userId: input.userId,
			score: input.score,
			createdAt: now,
			updatedAt: now,
		});
	}

	return {
		resourceId: input.resourceId,
		userId: input.userId,
		score: input.score,
		createdAt: now.toISOString(),
	};
}
