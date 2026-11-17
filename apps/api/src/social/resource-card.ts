import * as repo from "@procomun/db/repository";
import { favorites, ratings } from "@procomun/db/schema";
import { canViewResource } from "@procomun/db/validation";
import { inArray, sql } from "drizzle-orm";
import { getDb } from "../db.ts";
import {
	buildElpxMap,
	buildElpxPreview,
	type ElpxPreview,
	type ElpxRow,
} from "../elpx/preview.ts";

type ResourceWithId = { id: string };

/** Fila de un listado con recursos en cualquier estado (panel, favoritos…). */
type ResourceCardRow = ResourceWithId & {
	editorialStatus?: string | null;
	createdBy?: string | null;
	assignedCuratorId?: string | null;
};

type CardViewer = { id: string; role?: string | null };

type ResourceCardSignals = {
	elpxPreview: ElpxPreview | null;
	favoriteCount: number;
	rating: { average: number; count: number };
};

export type EnrichedResourceCard<T extends ResourceWithId> = T &
	ResourceCardSignals;

export function roundRatingAverage(value: unknown) {
	return Math.round(Number(value ?? 0) * 100) / 100;
}

export function buildResourceCard<T extends ResourceWithId>(
	row: T,
	signals: Partial<ResourceCardSignals>,
): EnrichedResourceCard<T> {
	return {
		...row,
		elpxPreview: signals.elpxPreview ?? null,
		favoriteCount: Number(signals.favoriteCount ?? 0),
		rating: {
			average: roundRatingAverage(signals.rating?.average),
			count: Number(signals.rating?.count ?? 0),
		},
	};
}

/**
 * Revisión de #481: lo publicado lleva las URL estables; lo demás, enlaces
 * firmados solo si `viewer` puede ver el recurso. Un favorito que se archivó
 * se queda sin imagen para quien ya no puede verlo. Sin estado conocido, se
 * firma: nunca se da la URL estable de algo que no consta como publicado.
 */
export function elpxPreviewForViewer(
	elpx: ElpxRow | null | undefined,
	row: Omit<ResourceCardRow, "id">,
	viewer: CardViewer | null,
): ElpxPreview | null {
	if (!canViewResource(viewer, row)) return null;
	return buildElpxPreview(elpx, row.editorialStatus ?? null);
}

export async function enrichResourceCards<T extends ResourceCardRow>(
	rows: T[],
	viewer: CardViewer | null,
) {
	if (rows.length === 0) {
		return [] as Array<EnrichedResourceCard<T>>;
	}

	const db = getDb().db;
	const resourceIds = rows.map((row) => row.id);
	const [elpxList, favoriteRows, ratingRows] = await Promise.all([
		repo.listElpxProjectsByResourceIds(db, resourceIds),
		db
			.select({
				resourceId: favorites.resourceId,
				count: sql<number>`count(*)`,
			})
			.from(favorites)
			.where(inArray(favorites.resourceId, resourceIds))
			.groupBy(favorites.resourceId),
		db
			.select({
				resourceId: ratings.resourceId,
				avg: sql<number>`coalesce(avg(${ratings.score}), 0)`,
				count: sql<number>`count(*)`,
			})
			.from(ratings)
			.where(inArray(ratings.resourceId, resourceIds))
			.groupBy(ratings.resourceId),
	]);

	const elpxMap = buildElpxMap(elpxList);
	const favoriteMap = new Map<string, number>(
		favoriteRows.map((row) => [row.resourceId, Number(row.count)]),
	);
	const ratingMap = new Map<string, { average: number; count: number }>(
		ratingRows.map((row) => [
			row.resourceId,
			{ average: Number(row.avg), count: Number(row.count) },
		]),
	);

	return rows.map((row) =>
		buildResourceCard(row, {
			elpxPreview: elpxPreviewForViewer(elpxMap.get(row.id), row, viewer),
			favoriteCount: favoriteMap.get(row.id) ?? 0,
			rating: ratingMap.get(row.id) ?? { average: 0, count: 0 },
		}),
	);
}
