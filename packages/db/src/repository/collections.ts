import { asc, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import {
	EDUCATIONAL_AREA_FIELD,
	EducationalAreaValidationError,
	inspectEducationalAssignments,
} from "../educational-areas.ts";
import { user } from "../schema/auth.ts";
import {
	collectionKeywords,
	collectionKnowledgeAreas,
	collections,
} from "../schema/collections.ts";
import { knowledgeAreas } from "../schema/knowledge-areas.ts";
import { tags } from "../schema/tags.ts";
import { VALID_LANGUAGES } from "../validation.ts";
import { assertCatalogKeywordIds } from "./keyword-catalog.ts";
import { assertResourceKnowledgeAreaIds } from "./knowledge-areas.ts";
import {
	andWhere,
	buildSearchTerm,
	buildSlug,
	collectionResourceCountSql,
	type DrizzleDB,
	normalizePagination,
	normalizeSearch,
} from "./shared.ts";

type CollectionFilters = {
	limit?: number;
	offset?: number;
	search?: string;
	language?: string;
	tagSlug?: string;
	knowledgeAreaIds?: string[];
	educationalCategory?: string;
	educationalOption?: string;
	curatorId?: string;
	status?: string;
	resourceStatus?: string;
	/** #538: oculta los borradores de coleccion que no son de este usuario. */
	hideOthersDraftsFor?: string;
};

const collectionSelection = (resourceStatus?: string) => ({
	id: collections.id,
	slug: collections.slug,
	title: collections.title,
	description: collections.description,
	coverImageUrl: collections.coverImageUrl,
	editorialStatus: collections.editorialStatus,
	curatorId: collections.curatorId,
	curatorName: user.name,
	resourceCount: collectionResourceCountSql(resourceStatus),
	isOrdered: collections.isOrdered,
	createdAt: collections.createdAt,
	updatedAt: collections.updatedAt,
});

export async function listCollections(
	db: DrizzleDB,
	opts: CollectionFilters = {},
) {
	const { limit, offset } = normalizePagination(opts.limit, opts.offset);
	const conditions = [];

	if (opts.search) {
		const term = buildSearchTerm(opts.search);
		conditions.push(
			sql`(${normalizeSearch(collections.title)} LIKE ${term} OR ${normalizeSearch(collections.description)} LIKE ${term})`,
		);
	}

	if (opts.language) conditions.push(eq(collections.language, opts.language));
	if (opts.tagSlug) {
		const slug = opts.tagSlug;
		// Usa el mismo slug que el filtro de recursos, incluidas sus equivalencias.
		conditions.push(sql`exists (
			select 1 from ${collectionKeywords} ck
			inner join ${tags} t on t.id = ck.tag_id
			where ck.collection_id = ${collections.id}
				and coalesce(t.canonical_tag_id, t.id) = (
					select coalesce(c.canonical_tag_id, c.id)
					from ${tags} c where c.slug = ${slug} limit 1
				)
		)`);
	}
	if (opts.knowledgeAreaIds?.length) {
		conditions.push(
			inArray(
				collections.id,
				db
					.select({ id: collectionKnowledgeAreas.collectionId })
					.from(collectionKnowledgeAreas)
					.where(
						inArray(collectionKnowledgeAreas.areaId, opts.knowledgeAreaIds),
					),
			),
		);
	}
	if (opts.educationalCategory) {
		const assignment = {
			categoryId: opts.educationalCategory,
			...(opts.educationalOption && { optionId: opts.educationalOption }),
		};
		conditions.push(
			sql`${collections.educationalAreas} @> ${JSON.stringify([assignment])}::jsonb`,
		);
	}
	if (opts.curatorId)
		conditions.push(eq(collections.curatorId, opts.curatorId));
	if (opts.status)
		conditions.push(eq(collections.editorialStatus, opts.status));
	// #538: el curator no ve los borradores ajenos. Misma regla que
	// canManageCollection y que listResources({ hideOthersDraftsFor }).
	if (opts.hideOthersDraftsFor) {
		const ownOrNotDraft = or(
			ne(collections.editorialStatus, "draft"),
			eq(collections.curatorId, opts.hideOthersDraftsFor),
		);
		if (ownOrNotDraft) conditions.push(ownOrNotDraft);
	}

	const where = conditions.length ? andWhere(conditions) : undefined;
	const query = db
		.select(collectionSelection(opts.resourceStatus))
		.from(collections)
		.leftJoin(user, eq(collections.curatorId, user.id))
		.limit(limit)
		.offset(offset)
		.orderBy(desc(collections.updatedAt), asc(collections.id));
	const rows = where ? await query.where(where) : await query;

	const countQuery = db
		.select({ count: sql<number>`count(*)` })
		.from(collections);
	const countRows = where ? await countQuery.where(where) : await countQuery;

	return { data: rows, total: Number(countRows[0]?.count ?? 0), limit, offset };
}

async function collectionMetadata(db: DrizzleDB, id: string) {
	const [catalogKeywords, areas] = await Promise.all([
		db
			.select({ id: tags.id, slug: tags.slug, label: tags.label })
			.from(collectionKeywords)
			.innerJoin(tags, eq(collectionKeywords.tagId, tags.id))
			.where(eq(collectionKeywords.collectionId, id))
			.orderBy(asc(tags.label)),
		db
			.select({
				id: knowledgeAreas.id,
				label: knowledgeAreas.label,
				blockId: knowledgeAreas.blockId,
				active: knowledgeAreas.active,
			})
			.from(collectionKnowledgeAreas)
			.innerJoin(
				knowledgeAreas,
				eq(collectionKnowledgeAreas.areaId, knowledgeAreas.id),
			)
			.where(eq(collectionKnowledgeAreas.collectionId, id))
			.orderBy(asc(knowledgeAreas.label)),
	]);
	return { catalogKeywords, knowledgeAreas: areas };
}

export async function getCollectionById(db: DrizzleDB, id: string) {
	const rows = await db
		.select({
			...collectionSelection(),
			language: collections.language,
			educationalAreas: collections.educationalAreas,
		})
		.from(collections)
		.leftJoin(user, eq(collections.curatorId, user.id))
		.where(eq(collections.id, id))
		.limit(1);

	const row = rows[0];
	return row ? { ...row, ...(await collectionMetadata(db, row.id)) } : null;
}

export async function getCollectionBySlug(
	db: DrizzleDB,
	slug: string,
	opts: { status?: string; resourceStatus?: string } = {},
) {
	const conditions = [eq(collections.slug, slug)];
	if (opts.status)
		conditions.push(eq(collections.editorialStatus, opts.status));

	const rows = await db
		.select({
			...collectionSelection(opts.resourceStatus),
			viewCount: collections.viewCount,
			language: collections.language,
			educationalAreas: collections.educationalAreas,
		})
		.from(collections)
		.leftJoin(user, eq(collections.curatorId, user.id))
		.where(andWhere(conditions))
		.limit(1);

	const row = rows[0];
	return row ? { ...row, ...(await collectionMetadata(db, row.id)) } : null;
}

export async function createCollection(
	db: DrizzleDB,
	data: {
		title: string;
		description: string;
		coverImageUrl?: string | null;
		curatorId: string;
		editorialStatus?: string;
		isOrdered?: boolean;
	},
) {
	const id = crypto.randomUUID();
	const slug = `${buildSlug(data.title)}-${id.slice(0, 8)}`;
	const now = new Date();

	await db.insert(collections).values({
		id,
		slug,
		title: data.title,
		description: data.description,
		coverImageUrl: data.coverImageUrl ?? null,
		curatorId: data.curatorId,
		editorialStatus: data.editorialStatus ?? "draft",
		isOrdered: data.isOrdered ?? false,
		createdAt: now,
		updatedAt: now,
	});

	return { id, slug };
}

export async function updateCollection(
	db: DrizzleDB,
	id: string,
	data: Partial<{
		title: string;
		description: string;
		coverImageUrl: string | null;
		editorialStatus: string;
		isOrdered: boolean;
		language: unknown;
		educationalAreas: unknown;
		keywordIds: unknown;
		knowledgeAreaIds: unknown;
	}>,
) {
	const {
		keywordIds,
		knowledgeAreaIds,
		educationalAreas,
		language,
		...fields
	} = data;
	if (
		language !== undefined &&
		language !== null &&
		(typeof language !== "string" ||
			!VALID_LANGUAGES.some((code) => code === language))
	) {
		throw Object.assign(new Error("Idioma no válido"), { status: 400 });
	}
	const classification =
		educationalAreas === undefined
			? undefined
			: inspectEducationalAssignments(educationalAreas);
	if (classification?.errors.length) {
		throw Object.assign(
			new EducationalAreaValidationError(classification.errors),
			{ status: 400, field: EDUCATIONAL_AREA_FIELD },
		);
	}
	const assignments = classification?.assignments;
	await db.transaction(async (tx: DrizzleDB) => {
		await tx
			.update(collections)
			.set({
				...fields,
				language,
				educationalAreas: assignments,
				updatedAt: new Date(),
			})
			.where(eq(collections.id, id));
		if (keywordIds === undefined && knowledgeAreaIds === undefined) return;
		const current = await collectionMetadata(tx, id);
		if (keywordIds !== undefined) {
			const ids = await assertCatalogKeywordIds(
				tx,
				keywordIds,
				current.catalogKeywords.map(({ id }) => id),
			);
			await tx
				.delete(collectionKeywords)
				.where(eq(collectionKeywords.collectionId, id));
			if (ids.length)
				await tx
					.insert(collectionKeywords)
					.values(ids.map((tagId) => ({ collectionId: id, tagId })))
					.onConflictDoNothing();
		}
		if (knowledgeAreaIds !== undefined) {
			const ids = await assertResourceKnowledgeAreaIds(
				tx,
				null,
				knowledgeAreaIds,
				current.knowledgeAreas.map(({ id }) => id),
			);
			await tx
				.delete(collectionKnowledgeAreas)
				.where(eq(collectionKnowledgeAreas.collectionId, id));
			if (ids.length)
				await tx
					.insert(collectionKnowledgeAreas)
					.values(ids.map((areaId) => ({ collectionId: id, areaId })))
					.onConflictDoNothing();
		}
	});
}

export async function deleteCollection(db: DrizzleDB, id: string) {
	await db.delete(collections).where(eq(collections.id, id));
}
