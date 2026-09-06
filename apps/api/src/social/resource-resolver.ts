import { resources } from "@procomun/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db.ts";

export async function resolveResourceBySlug(slug: string) {
	const db = getDb().db;
	const rows = await db
		.select({
			id: resources.id,
			title: resources.title,
			slug: resources.slug,
			editorialStatus: resources.editorialStatus,
		})
		.from(resources)
		.where(
			and(
				eq(resources.slug, slug),
				eq(resources.editorialStatus, "published"),
				isNull(resources.deletedAt),
			),
		)
		.limit(1);
	return rows[0] ?? null;
}
