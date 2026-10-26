import {
	and,
	asc,
	eq,
	inArray,
	isNull,
	type SQLWrapper,
	sql,
} from "drizzle-orm";
import { resourceTags, tagAliases, tags } from "../schema/tags.ts";
import {
	type KeywordCatalogEntry,
	type KeywordSuggestion,
	normalizeKeywordKey,
	searchKeywordCatalog,
	validateKeywordSelection,
} from "../tags/keyword-catalog.ts";
import { normalizeTagLabel, tagSlugFromLabel } from "../tags/normalize.ts";
import type { DrizzleDB } from "./shared.ts";
import { allocateUniqueSlug, recomputeUsageCount } from "./tags.ts";

export type CatalogKeyword = { id: string; slug: string; label: string };

/**
 * Denominaciones de catálogo de un recurso, separadas por comas. Es lo que
 * FTS, feeds y recomendaciones leen junto a `keywords` (ADR-0042).
 */
export function catalogLabelsSql(resourceId: SQLWrapper) {
	return sql<
		string | null
	>`(select string_agg(t.label, ',' order by t.label) from resource_tags rt join tags t on t.id = rt.tag_id where rt.resource_id = ${resourceId} and t.catalog)`;
}

/**
 * Términos seleccionables del catálogo con sus alias: sin los retirados por
 * pasar a ser áreas de conocimiento (#448). Dos consultas en total.
 */
export async function listKeywordCatalog(
	db: DrizzleDB,
): Promise<KeywordCatalogEntry[]> {
	const rows = await db
		.select({ id: tags.id, slug: tags.slug, label: tags.label })
		.from(tags)
		.where(
			and(
				eq(tags.catalog, true),
				isNull(tags.canonicalTagId),
				isNull(tags.retiredAt),
			),
		);
	const aliasRows = await db
		.select({ tagId: tagAliases.tagId, alias: tagAliases.alias })
		.from(tagAliases);
	return rows.map((row) => ({
		...row,
		aliases: aliasRows
			.filter((alias) => alias.tagId === row.id)
			.map((alias) => alias.alias),
	}));
}

export async function searchCatalogKeywords(
	db: DrizzleDB,
	query: string,
): Promise<KeywordSuggestion[]> {
	return searchKeywordCatalog(query, await listKeywordCatalog(db));
}

/**
 * Alta de un término (admin/curator, ruta protegida). Rechaza una
 * denominación normalizada repetida; el índice tags_catalog_label_unique
 * cubre dos altas simultáneas.
 */
export async function createCatalogKeyword(
	db: DrizzleDB,
	input: { label: string; aliases?: string[]; createdBy: string },
): Promise<
	| { status: "invalid" }
	| { status: "duplicate" | "created"; keyword: CatalogKeyword }
> {
	const label = normalizeTagLabel(input.label);
	const key = label ? normalizeKeywordKey(label) : "";
	if (!label || !key) return { status: "invalid" };

	// Incluye los retirados: su denominación sigue ocupando el índice único.
	const findDuplicate = async (): Promise<CatalogKeyword | undefined> => {
		const rows = await db
			.select({ id: tags.id, slug: tags.slug, label: tags.label })
			.from(tags)
			.where(eq(tags.catalog, true));
		return rows.find((entry) => normalizeKeywordKey(entry.label) === key);
	};
	const existing = await findDuplicate();
	if (existing) return { status: "duplicate", keyword: existing };

	const keyword = {
		id: crypto.randomUUID(),
		slug: await allocateUniqueSlug(db, tagSlugFromLabel(label)),
		label,
	};
	const inserted = await db
		.insert(tags)
		.values({ ...keyword, catalog: true, createdBy: input.createdBy })
		.onConflictDoNothing()
		.returning({ id: tags.id });
	if (inserted.length === 0) {
		// Otra alta simultánea ganó el índice único.
		const raced = await findDuplicate();
		if (!raced) throw new Error("No se pudo crear la palabra clave");
		return { status: "duplicate", keyword: raced };
	}

	const seen = new Set([key]);
	for (const raw of input.aliases ?? []) {
		const alias = normalizeTagLabel(raw);
		const normalized = alias ? normalizeKeywordKey(alias) : "";
		if (!alias || !normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		await db.insert(tagAliases).values({
			id: `${keyword.id}:${normalized}`,
			tagId: keyword.id,
			alias,
			normalized,
		});
	}
	return { status: "created", keyword };
}

export async function listResourceCatalogKeywords(
	db: DrizzleDB,
	resourceId: string,
): Promise<CatalogKeyword[]> {
	return db
		.select({ id: tags.id, slug: tags.slug, label: tags.label })
		.from(resourceTags)
		.innerJoin(tags, eq(resourceTags.tagId, tags.id))
		.where(and(eq(resourceTags.resourceId, resourceId), eq(tags.catalog, true)))
		.orderBy(asc(tags.label));
}

/**
 * Valida una selección: lista de ids del catálogo, sin duplicados y como
 * máximo 5. Un término retirado (#448) solo vale si ya estaba en `keep` (las
 * palabras clave actuales del recurso). Lanza un Error con `status: 400`,
 * que las rutas CRUD convierten en respuesta.
 */
export async function assertCatalogKeywordIds(
	db: DrizzleDB,
	keywordIds: unknown,
	keep: readonly string[] = [],
): Promise<string[]> {
	const selection = validateKeywordSelection(keywordIds);
	if (!selection.ok) {
		throw Object.assign(new Error(selection.message), { status: 400 });
	}
	if (selection.ids.length > 0) {
		const found = await db
			.select({ id: tags.id, label: tags.label, retiredAt: tags.retiredAt })
			.from(tags)
			.where(and(inArray(tags.id, selection.ids), eq(tags.catalog, true)));
		if (found.length !== selection.ids.length) {
			throw Object.assign(
				new Error("Alguna palabra clave no pertenece al catálogo"),
				{ status: 400 },
			);
		}
		const retired = found.find(
			(row) => row.retiredAt !== null && !keep.includes(row.id),
		);
		if (retired) {
			throw Object.assign(
				new Error(
					`La palabra clave «${retired.label}» se ha retirado del catálogo: usa el área de conocimiento`,
				),
				{ status: 400 },
			);
		}
	}
	return selection.ids;
}

/**
 * Sustituye las palabras clave de catálogo del recurso. No toca las
 * etiquetas libres ni el texto de `keywords`.
 */
export async function setResourceCatalogKeywords(
	db: DrizzleDB,
	resourceId: string,
	keywordIds: unknown,
): Promise<void> {
	const current = (await listResourceCatalogKeywords(db, resourceId)).map(
		(keyword) => keyword.id,
	);
	const desired = await assertCatalogKeywordIds(db, keywordIds, current);
	const toRemove = current.filter((id) => !desired.includes(id));
	const toAdd = desired.filter((id) => !current.includes(id));

	if (toRemove.length > 0) {
		await db
			.delete(resourceTags)
			.where(
				and(
					eq(resourceTags.resourceId, resourceId),
					inArray(resourceTags.tagId, toRemove),
				),
			);
	}
	if (toAdd.length > 0) {
		await db
			.insert(resourceTags)
			.values(toAdd.map((tagId) => ({ resourceId, tagId })))
			.onConflictDoNothing();
	}
	for (const tagId of [...toRemove, ...toAdd]) {
		await recomputeUsageCount(db, tagId);
	}
}
