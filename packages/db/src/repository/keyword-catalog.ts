import {
	and,
	asc,
	eq,
	inArray,
	isNotNull,
	isNull,
	type SQLWrapper,
	sql,
} from "drizzle-orm";
import { resources } from "../schema/resources.ts";
import { resourceTags, tagAliases, tags } from "../schema/tags.ts";
import {
	type KeywordCatalogEntry,
	type KeywordSuggestion,
	keywordIndex,
	MAX_KEYWORD_SELECTIONS,
	matchLegacyLabels,
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

/** Términos activos del catálogo con sus alias. Dos consultas en total. */
export async function listKeywordCatalog(
	db: DrizzleDB,
): Promise<KeywordCatalogEntry[]> {
	const rows = await db
		.select({ id: tags.id, slug: tags.slug, label: tags.label })
		.from(tags)
		.where(and(eq(tags.catalog, true), isNull(tags.canonicalTagId)));
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

	const findDuplicate = async (): Promise<CatalogKeyword | undefined> => {
		const match = (await listKeywordCatalog(db)).find(
			(entry) => normalizeKeywordKey(entry.label) === key,
		);
		return match && { id: match.id, slug: match.slug, label: match.label };
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
 * máximo 5. Lanza un Error con `status: 400`, que las rutas CRUD convierten
 * en respuesta.
 */
export async function assertCatalogKeywordIds(
	db: DrizzleDB,
	keywordIds: unknown,
): Promise<string[]> {
	const selection = validateKeywordSelection(keywordIds);
	if (!selection.ok) {
		throw Object.assign(new Error(selection.message), { status: 400 });
	}
	if (selection.ids.length > 0) {
		const found = await db
			.select({ id: tags.id })
			.from(tags)
			.where(and(inArray(tags.id, selection.ids), eq(tags.catalog, true)));
		if (found.length !== selection.ids.length) {
			throw Object.assign(
				new Error("Alguna palabra clave no pertenece al catálogo"),
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
	const desired = await assertCatalogKeywordIds(db, keywordIds);
	const current = (await listResourceCatalogKeywords(db, resourceId)).map(
		(keyword) => keyword.id,
	);
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

export type LegacyKeywordReport = {
	dryRun: boolean;
	totals: {
		resources: number;
		withMatch: number;
		coverage: number;
		assigned: number;
		alreadyAssigned: number;
		overLimit: number;
	};
	/** Etiquetas sin correspondencia, con el número de recursos que las usan. */
	unmatched: Array<{ label: string; resources: number }>;
	/** Alias de varios términos (ABP): necesitan una correspondencia confirmada. */
	ambiguous: Array<{ label: string; resources: number }>;
	/** Superarían 5 términos: no se asigna nada hasta revisarlos. */
	overLimit: Array<{
		resourceId: string;
		title: string;
		current: string[];
		proposed: string[];
	}>;
	assigned: Array<{ resourceId: string; added: string[] }>;
};

type LabelCounts = Map<string, { label: string; resources: number }>;

/** Cuenta cada etiqueta una vez por recurso. */
function tally(counts: LabelCounts, labels: string[]) {
	for (const key of new Set(labels.map(normalizeKeywordKey))) {
		const entry = counts.get(key) ?? {
			label: labels.find((label) => normalizeKeywordKey(label) === key) ?? key,
			resources: 0,
		};
		entry.resources += 1;
		counts.set(key, entry);
	}
}

function sortByUse(counts: LabelCounts) {
	return [...counts.values()].sort(
		(a, b) => b.resources - a.resources || a.label.localeCompare(b.label, "es"),
	);
}

/**
 * Correspondencia de las etiquetas de origen (`resources.keywords`) con el
 * catálogo (issue #384, apartado 5). Identidad y alias; nunca crea términos
 * ni toca `keywords`. Lee catálogo, recursos y enlaces una sola vez.
 * Repetirla no duplica nada: solo añade los ids que faltan.
 */
export async function mapLegacyKeywords(
	db: DrizzleDB,
	options: { dryRun: boolean },
): Promise<LegacyKeywordReport> {
	const index = keywordIndex(await listKeywordCatalog(db));
	const rows = await db
		.select({
			id: resources.id,
			title: resources.title,
			keywords: resources.keywords,
		})
		.from(resources)
		.where(and(isNull(resources.deletedAt), isNotNull(resources.keywords)));
	const links = await db
		.select({ resourceId: resourceTags.resourceId, tagId: resourceTags.tagId })
		.from(resourceTags)
		.innerJoin(tags, eq(resourceTags.tagId, tags.id))
		.where(eq(tags.catalog, true));
	const current = new Map<string, string[]>();
	for (const link of links) {
		current.set(link.resourceId, [
			...(current.get(link.resourceId) ?? []),
			link.tagId,
		]);
	}

	const unmatched: LabelCounts = new Map();
	const ambiguous: LabelCounts = new Map();
	const report: LegacyKeywordReport = {
		dryRun: options.dryRun,
		totals: {
			resources: rows.length,
			withMatch: 0,
			coverage: 0,
			assigned: 0,
			alreadyAssigned: 0,
			overLimit: 0,
		},
		unmatched: [],
		ambiguous: [],
		overLimit: [],
		assigned: [],
	};

	for (const row of rows) {
		// El importador unió las etiquetas de origen con comas (buildKeywords).
		const match = matchLegacyLabels((row.keywords ?? "").split(","), index);
		tally(unmatched, match.unmatched);
		tally(ambiguous, match.ambiguous);
		if (match.ids.length === 0) continue;
		report.totals.withMatch += 1;

		const have = current.get(row.id) ?? [];
		const added = match.ids.filter((id) => !have.includes(id));
		if (added.length === 0) {
			report.totals.alreadyAssigned += 1;
		} else if (have.length + added.length > MAX_KEYWORD_SELECTIONS) {
			report.overLimit.push({
				resourceId: row.id,
				title: row.title,
				current: have,
				proposed: match.ids,
			});
		} else {
			report.assigned.push({ resourceId: row.id, added });
		}
	}

	report.totals.coverage =
		rows.length === 0 ? 0 : report.totals.withMatch / rows.length;
	report.totals.assigned = report.assigned.length;
	report.totals.overLimit = report.overLimit.length;
	report.unmatched = sortByUse(unmatched);
	report.ambiguous = sortByUse(ambiguous);

	const values = report.assigned.flatMap(({ resourceId, added }) =>
		added.map((tagId) => ({ resourceId, tagId })),
	);
	if (!options.dryRun && values.length > 0) {
		// Lotes de 500 filas para no acercarse al límite de parámetros del driver.
		for (let i = 0; i < values.length; i += 500) {
			await db
				.insert(resourceTags)
				.values(values.slice(i, i + 500))
				.onConflictDoNothing();
		}
		for (const tagId of new Set(values.map((value) => value.tagId))) {
			await recomputeUsageCount(db, tagId);
		}
	}
	return report;
}
