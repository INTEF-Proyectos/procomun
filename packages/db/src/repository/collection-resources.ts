import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { user } from "../schema/auth.ts";
import { collectionResources, collections } from "../schema/collections.ts";
import { resources } from "../schema/resources.ts";
import { hasMinRole } from "../validation.ts";
import { andWhere, type DrizzleDB, normalizePagination } from "./shared.ts";

type CollectionResourceViewer = { id: string; role?: string | null } | null;

async function getNextCollectionResourcePosition(
	db: DrizzleDB,
	collectionId: string,
) {
	const rows = await db
		.select({
			maxPosition: sql<number>`coalesce(max(${collectionResources.position}), -1)`,
		})
		.from(collectionResources)
		.where(eq(collectionResources.collectionId, collectionId));
	return (rows[0]?.maxPosition ?? -1) + 1;
}

export async function addResourceToCollection(
	db: DrizzleDB,
	collectionId: string,
	resourceId: string,
	position?: number,
) {
	const nextPosition =
		position === undefined
			? await getNextCollectionResourcePosition(db, collectionId)
			: position;

	await db
		.insert(collectionResources)
		.values({
			collectionId,
			resourceId,
			position: nextPosition,
		})
		.onConflictDoNothing();
}

export async function removeResourceFromCollection(
	db: DrizzleDB,
	collectionId: string,
	resourceId: string,
) {
	await db
		.delete(collectionResources)
		.where(
			and(
				eq(collectionResources.collectionId, collectionId),
				eq(collectionResources.resourceId, resourceId),
			),
		);
}

export async function listCollectionResources(
	db: DrizzleDB,
	collectionId: string,
	opts: {
		limit?: number;
		offset?: number;
		status?: string;
		viewer?: CollectionResourceViewer;
	} = {},
) {
	const { limit, offset } = normalizePagination(
		opts.limit ?? 100,
		opts.offset,
		100,
	);
	const conditions: ReturnType<typeof or>[] = [
		eq(collectionResources.collectionId, collectionId),
		isNull(resources.deletedAt),
	];

	if (opts.status) conditions.push(eq(resources.editorialStatus, opts.status));
	const viewer = opts.viewer;
	if (viewer !== undefined && !hasMinRole(viewer?.role, "admin")) {
		const visible =
			viewer && hasMinRole(viewer.role, "curator")
				? sql`${resources.editorialStatus} is distinct from 'draft'`
				: eq(resources.editorialStatus, "published");
		conditions.push(
			viewer ? or(visible, eq(resources.createdBy, viewer.id)) : visible,
		);
	}

	return db
		.select({
			resourceId: collectionResources.resourceId,
			position: collectionResources.position,
			title: resources.title,
			slug: resources.slug,
			description: resources.description,
			resourceType: resources.resourceType,
			language: resources.language,
			license: resources.license,
			author: resources.author,
			thumbnailUrl: resources.thumbnailUrl,
			// Para decidir quién puede ver la miniatura de lo no publicado (#481).
			createdBy: resources.createdBy,
			createdByName: user.name,
			// Sin cuenta activa no hay ficha de autor que enlazar (#541).
			createdByActive: sql<boolean>`(${user.id} is not null and ${user.deletedAt} is null)`,
			editorialStatus: resources.editorialStatus,
		})
		.from(collectionResources)
		.innerJoin(resources, eq(collectionResources.resourceId, resources.id))
		.leftJoin(user, eq(resources.createdBy, user.id))
		.where(andWhere(conditions))
		.orderBy(asc(collectionResources.position))
		.limit(limit)
		.offset(offset);
}

export async function reorderCollectionResource(
	db: DrizzleDB,
	collectionId: string,
	resourceId: string,
	direction: "up" | "down",
	viewer?: CollectionResourceViewer,
) {
	return db.transaction(async (tx: DrizzleDB) => {
		// Serializa las reordenaciones de la colección antes de leer sus posiciones.
		await tx
			.select({ id: collections.id })
			.from(collections)
			.where(eq(collections.id, collectionId))
			.for("update");

		const items = await listCollectionResources(tx, collectionId, { viewer });
		const index = items.findIndex((item) => item.resourceId === resourceId);
		if (index < 0) return false;

		const current = items[index];
		const adjacent = items[direction === "up" ? index - 1 : index + 1];
		if (!current || !adjacent) return false;

		await tx
			.update(collectionResources)
			.set({
				position: sql`case when ${collectionResources.resourceId} = ${current.resourceId}
					then ${adjacent.position}::integer else ${current.position}::integer end`,
			})
			.where(
				and(
					eq(collectionResources.collectionId, collectionId),
					inArray(collectionResources.resourceId, [
						current.resourceId,
						adjacent.resourceId,
					]),
				),
			);

		return true;
	});
}
