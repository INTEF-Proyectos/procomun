import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { collectionKeywords } from "../schema/collections.ts";
import { resources } from "../schema/resources.ts";
import { resourceTags, tags } from "../schema/tags.ts";
import {
	findSimilarTags,
	normalizeTagLabel,
	parseKeywordString,
	tagSlugFromLabel,
	uniqueNormalizedLabels,
} from "../tags/normalize.ts";
import {
	andWhere,
	buildSearchTerm,
	type DrizzleDB,
	normalizePagination,
	normalizeSearch,
} from "./shared.ts";

export type TagRecord = {
	id: string;
	slug: string;
	label: string;
	description: string | null;
	usageCount: number;
	canonicalTagId: string | null;
	catalog: boolean;
	createdBy: string | null;
	createdAt: Date;
	updatedAt: Date;
};

const tagSelect = {
	id: tags.id,
	slug: tags.slug,
	label: tags.label,
	description: tags.description,
	usageCount: tags.usageCount,
	canonicalTagId: tags.canonicalTagId,
	catalog: tags.catalog,
	createdBy: tags.createdBy,
	createdAt: tags.createdAt,
	updatedAt: tags.updatedAt,
};

export class TagNotFoundError extends Error {
	constructor(idOrSlug: string) {
		super(`Tag not found: ${idOrSlug}`);
		this.name = "TagNotFoundError";
	}
}

export class TagMergeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TagMergeError";
	}
}

export async function allocateUniqueSlug(
	db: DrizzleDB,
	baseSlug: string,
	excludeId?: string,
): Promise<string> {
	let candidate = baseSlug;
	let n = 0;
	for (;;) {
		const rows = await db
			.select({ id: tags.id })
			.from(tags)
			.where(eq(tags.slug, candidate))
			.limit(1);
		const existing = rows[0];
		if (!existing || existing.id === excludeId) return candidate;
		n += 1;
		candidate = `${baseSlug}-${n}`;
	}
}

/** Resolve to canonical tag id when the row is a synonym. */
export async function resolveCanonicalTagId(
	db: DrizzleDB,
	tagId: string,
): Promise<string> {
	const row = await db
		.select({ id: tags.id, canonicalTagId: tags.canonicalTagId })
		.from(tags)
		.where(eq(tags.id, tagId))
		.limit(1);
	const found = row[0];
	if (!found) throw new TagNotFoundError(tagId);
	return found.canonicalTagId ?? found.id;
}

export async function getTagById(
	db: DrizzleDB,
	id: string,
): Promise<TagRecord | null> {
	const rows = await db
		.select(tagSelect)
		.from(tags)
		.where(eq(tags.id, id))
		.limit(1);
	return rows[0] ?? null;
}

export async function getTagBySlug(
	db: DrizzleDB,
	slug: string,
): Promise<TagRecord | null> {
	const rows = await db
		.select(tagSelect)
		.from(tags)
		.where(eq(tags.slug, slug))
		.limit(1);
	return rows[0] ?? null;
}

/**
 * Find or create a canonical tag by label.
 * If a synonym matches, returns the canonical tag.
 */
export async function ensureTag(
	db: DrizzleDB,
	rawLabel: string,
): Promise<TagRecord> {
	const label = normalizeTagLabel(rawLabel);
	if (!label) {
		throw new Error("Tag label is required");
	}
	const slug = tagSlugFromLabel(label);

	const bySlug = await getTagBySlug(db, slug);
	if (bySlug) {
		if (bySlug.canonicalTagId) {
			const canonical = await getTagById(db, bySlug.canonicalTagId);
			if (canonical) return canonical;
		}
		return bySlug;
	}

	const id = crypto.randomUUID();
	const now = new Date();
	const uniqueSlug = await allocateUniqueSlug(db, slug);
	await db.insert(tags).values({
		id,
		slug: uniqueSlug,
		label,
		description: null,
		usageCount: 0,
		canonicalTagId: null,
		createdAt: now,
		updatedAt: now,
	});

	const created = await getTagById(db, id);
	if (!created) throw new Error("Failed to create tag");
	return created;
}

export async function listTags(
	db: DrizzleDB,
	opts: {
		limit?: number;
		offset?: number;
		search?: string;
		/** When true, only canonical tags (no synonyms). Default true. */
		canonicalOnly?: boolean;
	} = {},
) {
	const { limit, offset } = normalizePagination(opts.limit, opts.offset);
	const conditions = [];
	const canonicalOnly = opts.canonicalOnly !== false;

	if (canonicalOnly) {
		conditions.push(isNull(tags.canonicalTagId));
	}
	if (opts.search) {
		const term = buildSearchTerm(opts.search);
		conditions.push(
			sql`(${normalizeSearch(tags.label)} LIKE ${term} OR ${normalizeSearch(tags.slug)} LIKE ${term})`,
		);
	}

	const where = andWhere(conditions);
	const query = db
		.select(tagSelect)
		.from(tags)
		.limit(limit)
		.offset(offset)
		.orderBy(desc(tags.usageCount), asc(tags.label));
	const rows = where ? await query.where(where) : await query;

	const countQuery = db.select({ count: sql<number>`count(*)` }).from(tags);
	const countRows = where ? await countQuery.where(where) : await countQuery;

	return {
		data: rows,
		total: Number(countRows[0]?.count ?? 0),
		limit,
		offset,
	};
}

export async function listPopularTags(db: DrizzleDB, limit = 20) {
	const { limit: safeLimit } = normalizePagination(limit, 0);
	return db
		.select(tagSelect)
		.from(tags)
		.where(and(isNull(tags.canonicalTagId), sql`${tags.usageCount} > 0`))
		.orderBy(desc(tags.usageCount), asc(tags.label))
		.limit(Math.min(safeLimit, 50));
}

/** Autocomplete: prefix / contains match, fast path for tagging UI. */
export async function suggestTags(
	db: DrizzleDB,
	query: string,
	limit = 10,
): Promise<TagRecord[]> {
	const q = query.trim();
	if (!q) {
		return listPopularTags(db, limit);
	}
	const result = await listTags(db, {
		search: q,
		limit: Math.min(limit, 25),
		offset: 0,
		canonicalOnly: true,
	});
	return result.data;
}

export async function listResourceTags(
	db: DrizzleDB,
	resourceId: string,
): Promise<TagRecord[]> {
	const rows = await db
		.select(tagSelect)
		.from(resourceTags)
		.innerJoin(tags, eq(resourceTags.tagId, tags.id))
		.where(eq(resourceTags.resourceId, resourceId))
		.orderBy(asc(tags.label));
	return rows;
}

export async function recomputeUsageCount(db: DrizzleDB, tagId: string) {
	const countRows = await db
		.select({ count: sql<number>`count(*)` })
		.from(resourceTags)
		.where(eq(resourceTags.tagId, tagId));
	const count = Number(countRows[0]?.count ?? 0);
	await db
		.update(tags)
		.set({ usageCount: count, updatedAt: new Date() })
		.where(eq(tags.id, tagId));
	return count;
}

/**
 * Replace the free tags of a resource with the given labels (create missing).
 * Returns the final tag list. Also refreshes denormalized usage counts.
 * ADR-0042: free text never attaches or removes catalog keywords, and
 * `resources.keywords` keeps the original text.
 */
export async function setResourceTagsByLabels(
	db: DrizzleDB,
	resourceId: string,
	labels: string[],
): Promise<TagRecord[]> {
	const normalized = uniqueNormalizedLabels(labels);
	const desired: TagRecord[] = [];
	for (const label of normalized) {
		const tag = await ensureTag(db, label);
		if (!tag.catalog) desired.push(tag);
	}
	const desiredIds = new Set(desired.map((t) => t.id));

	const current = (await listResourceTags(db, resourceId)).filter(
		(t) => !t.catalog,
	);
	const currentIds = new Set(current.map((t) => t.id));

	const toRemove = current.filter((t) => !desiredIds.has(t.id));
	const toAdd = desired.filter((t) => !currentIds.has(t.id));

	if (toRemove.length > 0) {
		await db.delete(resourceTags).where(
			and(
				eq(resourceTags.resourceId, resourceId),
				inArray(
					resourceTags.tagId,
					toRemove.map((t) => t.id),
				),
			),
		);
	}

	const now = new Date();
	for (const tag of toAdd) {
		await db.insert(resourceTags).values({
			resourceId,
			tagId: tag.id,
			createdAt: now,
		});
	}

	const touched = new Set([
		...toRemove.map((t) => t.id),
		...toAdd.map((t) => t.id),
	]);
	for (const tagId of touched) {
		await recomputeUsageCount(db, tagId);
	}

	return listResourceTags(db, resourceId);
}

/**
 * Sync tags from a free-text keywords string (create + attach, dual-write path).
 */
export async function syncTagsFromKeywords(
	db: DrizzleDB,
	resourceId: string,
	keywords: string | null | undefined,
): Promise<TagRecord[]> {
	const labels = parseKeywordString(keywords);
	return setResourceTagsByLabels(db, resourceId, labels);
}

/**
 * Bulk migrate resources.keywords → resource_tags.
 * Idempotent: re-running re-syncs labels from keywords.
 */
export async function migrateKeywordsToTags(db: DrizzleDB): Promise<{
	resourcesProcessed: number;
	tagsCreated: number;
	linksCreated: number;
}> {
	const rows = await db
		.select({ id: resources.id, keywords: resources.keywords })
		.from(resources)
		.where(
			and(isNull(resources.deletedAt), sql`${resources.keywords} IS NOT NULL`),
		);

	let tagsCreated = 0;
	let linksCreated = 0;
	const beforeCount = await db
		.select({ count: sql<number>`count(*)` })
		.from(tags);
	const tagsBefore = Number(beforeCount[0]?.count ?? 0);
	const linksBeforeRows = await db
		.select({ count: sql<number>`count(*)` })
		.from(resourceTags);
	const linksBefore = Number(linksBeforeRows[0]?.count ?? 0);

	for (const row of rows) {
		await syncTagsFromKeywords(db, row.id, row.keywords);
	}

	const afterCount = await db
		.select({ count: sql<number>`count(*)` })
		.from(tags);
	const tagsAfter = Number(afterCount[0]?.count ?? 0);
	const linksAfterRows = await db
		.select({ count: sql<number>`count(*)` })
		.from(resourceTags);
	const linksAfter = Number(linksAfterRows[0]?.count ?? 0);

	tagsCreated = Math.max(0, tagsAfter - tagsBefore);
	linksCreated = Math.max(0, linksAfter - linksBefore);

	return {
		resourcesProcessed: rows.length,
		tagsCreated,
		linksCreated,
	};
}

export async function updateTag(
	db: DrizzleDB,
	id: string,
	data: { label?: string; description?: string | null },
): Promise<TagRecord> {
	const existing = await getTagById(db, id);
	if (!existing) throw new TagNotFoundError(id);

	const patch: {
		label?: string;
		slug?: string;
		description?: string | null;
		updatedAt: Date;
	} = { updatedAt: new Date() };

	if (data.label !== undefined) {
		const label = normalizeTagLabel(data.label);
		if (!label) throw new Error("Tag label is required");
		const slug = await allocateUniqueSlug(db, tagSlugFromLabel(label), id);
		patch.label = label;
		patch.slug = slug;
	}
	if (data.description !== undefined) {
		patch.description = data.description;
	}

	await db.update(tags).set(patch).where(eq(tags.id, id));
	const updated = await getTagById(db, id);
	if (!updated) throw new TagNotFoundError(id);
	return updated;
}

/**
 * Merge source into target: reassign resource links, mark source as synonym of target.
 */
export async function mergeTags(
	db: DrizzleDB,
	sourceId: string,
	targetId: string,
): Promise<{ target: TagRecord; reassigned: number }> {
	if (sourceId === targetId) {
		throw new TagMergeError("Cannot merge a tag into itself");
	}
	const source = await getTagById(db, sourceId);
	const target = await getTagById(db, targetId);
	if (!source) throw new TagNotFoundError(sourceId);
	if (!target) throw new TagNotFoundError(targetId);
	if (target.canonicalTagId) {
		throw new TagMergeError(
			"Target tag is itself a synonym; merge into canonical",
		);
	}
	// Moving free-tag links onto a catalog keyword could exceed 5 per resource.
	if (source.catalog !== target.catalog) {
		throw new TagMergeError(
			"Cannot merge a free tag with a catalog keyword (ADR-0042)",
		);
	}

	const sourceLinks = await db
		.select({ resourceId: resourceTags.resourceId })
		.from(resourceTags)
		.where(eq(resourceTags.tagId, sourceId));

	let reassigned = 0;
	const now = new Date();
	for (const link of sourceLinks) {
		const existing = await db
			.select({ resourceId: resourceTags.resourceId })
			.from(resourceTags)
			.where(
				and(
					eq(resourceTags.resourceId, link.resourceId),
					eq(resourceTags.tagId, targetId),
				),
			)
			.limit(1);
		if (existing.length === 0) {
			await db.insert(resourceTags).values({
				resourceId: link.resourceId,
				tagId: targetId,
				createdAt: now,
			});
			reassigned += 1;
		}
	}

	await db.delete(resourceTags).where(eq(resourceTags.tagId, sourceId));

	// Las colecciones también enlazan palabras clave de catálogo (#611).
	const collectionLinks = await db
		.select({ collectionId: collectionKeywords.collectionId })
		.from(collectionKeywords)
		.where(eq(collectionKeywords.tagId, sourceId));
	if (collectionLinks.length > 0) {
		await db
			.insert(collectionKeywords)
			.values(
				collectionLinks.map(({ collectionId }) => ({
					collectionId,
					tagId: targetId,
				})),
			)
			.onConflictDoNothing();
		await db
			.delete(collectionKeywords)
			.where(eq(collectionKeywords.tagId, sourceId));
	}

	await db
		.update(tags)
		.set({
			canonicalTagId: targetId,
			usageCount: 0,
			updatedAt: now,
		})
		.where(eq(tags.id, sourceId));

	// Point other synonyms of source to target
	await db
		.update(tags)
		.set({ canonicalTagId: targetId, updatedAt: now })
		.where(eq(tags.canonicalTagId, sourceId));

	await recomputeUsageCount(db, targetId);
	const updatedTarget = await getTagById(db, targetId);
	if (!updatedTarget) throw new TagNotFoundError(targetId);
	return { target: updatedTarget, reassigned };
}

export async function deleteTag(
	db: DrizzleDB,
	id: string,
	opts: { reassignToId?: string } = {},
): Promise<void> {
	const existing = await getTagById(db, id);
	if (!existing) throw new TagNotFoundError(id);

	if (opts.reassignToId) {
		await mergeTags(db, id, opts.reassignToId);
		// After merge, source remains as synonym — remove the row fully
		await db.delete(resourceTags).where(eq(resourceTags.tagId, id));
		await db
			.update(tags)
			.set({ canonicalTagId: null })
			.where(eq(tags.canonicalTagId, id));
		await db.delete(tags).where(eq(tags.id, id));
		return;
	}

	await db.delete(resourceTags).where(eq(resourceTags.tagId, id));
	await db
		.update(tags)
		.set({ canonicalTagId: null })
		.where(eq(tags.canonicalTagId, id));
	await db.delete(tags).where(eq(tags.id, id));
}

export async function listSimilarTagsFor(
	db: DrizzleDB,
	tagId: string,
	opts: { maxDistance?: number; limit?: number } = {},
): Promise<TagRecord[]> {
	const tag = await getTagById(db, tagId);
	if (!tag) throw new TagNotFoundError(tagId);

	const catalog = await db
		.select({ id: tags.id, label: tags.label, slug: tags.slug })
		.from(tags)
		.where(isNull(tags.canonicalTagId));

	const similar = findSimilarTags(catalog, {
		label: tag.label,
		slug: tag.slug,
		excludeId: tag.id,
		maxDistance: opts.maxDistance,
		limit: opts.limit,
	});

	if (similar.length === 0) return [];
	const ids = similar.map((s) => s.id);
	const rows = await db
		.select(tagSelect)
		.from(tags)
		.where(inArray(tags.id, ids));
	// Preserve similarity order
	const byId = new Map(rows.map((r) => [r.id, r]));
	return ids.map((id) => byId.get(id)).filter((r): r is TagRecord => r != null);
}

/** Resource ids that carry the given tag (canonical). */
export async function listResourceIdsByTagSlug(
	db: DrizzleDB,
	slug: string,
): Promise<{ tag: TagRecord; resourceIds: string[] }> {
	const tag = await getTagBySlug(db, slug);
	if (!tag) throw new TagNotFoundError(slug);
	const canonicalId = tag.canonicalTagId ?? tag.id;
	const canonical =
		canonicalId === tag.id ? tag : ((await getTagById(db, canonicalId)) ?? tag);

	// Include synonyms that point to this canonical
	const synonymRows = await db
		.select({ id: tags.id })
		.from(tags)
		.where(eq(tags.canonicalTagId, canonical.id));
	const tagIds = [canonical.id, ...synonymRows.map((s) => s.id)];

	const links = await db
		.select({ resourceId: resourceTags.resourceId })
		.from(resourceTags)
		.where(inArray(resourceTags.tagId, tagIds));

	return {
		tag: canonical,
		resourceIds: [...new Set(links.map((l) => l.resourceId))],
	};
}
