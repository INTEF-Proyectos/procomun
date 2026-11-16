/**
 * Related-resource recommendations (ADR-0036).
 * SQL builds a feature vector per candidate; TypeScript applies pure scores.
 */

import {
	catalogLabelsSql,
	type DrizzleDB,
	listElpxProjectsByResourceIds,
} from "@procomun/db/repository";
import { resources } from "@procomun/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
	buildElpxMap,
	buildElpxPreview,
	type ElpxPreview,
} from "../elpx/preview.ts";
import { rowsFromExecute } from "../fts/search.ts";
import {
	clampRelatedLimit,
	pickSameAuthorExtras,
	type RecommendationSignals,
	rankRelatedCandidates,
	SAME_AUTHOR_LIMIT,
	type ScoredCandidate,
} from "./score.ts";

export type RelatedResourceCard = {
	id: string;
	slug: string;
	title: string;
	description: string;
	resourceType: string;
	language: string | null;
	license: string;
	author: string | null;
	editorialStatus: string;
	/** Sello «Validado» (#420). */
	validatedAt: Date | string | null;
	validationSource: string | null;
	updatedAt: Date | string | null;
	score: number;
	signals: RecommendationSignals;
	elpxPreview: ElpxPreview | null;
};

export type RelatedResourcesResult = {
	data: RelatedResourceCard[];
	sameAuthor: RelatedResourceCard[];
	limit: number;
};

/** Soft cap when ranking the full signal pool for extras. */
const RELATED_POOL_CAP = 24;

type SignalRow = {
	id: string;
	slug: string;
	title: string;
	description: string;
	resource_type: string;
	language: string | null;
	license: string;
	author: string | null;
	editorial_status: string;
	validated_at: Date | string | null;
	validation_source: string | null;
	updated_at: Date | string | null;
	shared_subjects: string | number;
	shared_levels: string | number;
	same_resource_type: string | number | boolean;
	same_language: string | number | boolean;
	shared_keywords: string | number;
	same_author: string | number | boolean;
	collection_cooccurrence: string | number;
	fts_rank: string | number | null;
};

function toBool(value: string | number | boolean): boolean {
	if (typeof value === "boolean") return value;
	if (typeof value === "number") return value !== 0;
	return value === "t" || value === "true" || value === "1";
}

function toNumber(value: string | number | null | undefined): number {
	const n = Number(value ?? 0);
	return Number.isFinite(n) ? n : 0;
}

function rowToSignals(row: SignalRow): RecommendationSignals {
	return {
		sharedSubjects: toNumber(row.shared_subjects),
		sharedLevels: toNumber(row.shared_levels),
		sameResourceType: toBool(row.same_resource_type),
		sameLanguage: toBool(row.same_language),
		sharedKeywords: toNumber(row.shared_keywords),
		sameAuthor: toBool(row.same_author),
		collectionCooccurrence: toNumber(row.collection_cooccurrence),
		// ts_rank with normalization 32 is already ~0–1; keep raw non-negative.
		ftsRank: Math.max(0, toNumber(row.fts_rank)),
	};
}

/**
 * Fetch signal vectors for published candidates related to seedId.
 * Prefilters to rows with at least one non-zero signal to keep the set small.
 */
export async function loadRecommendationSignalRows(
	db: DrizzleDB,
	seedId: string,
): Promise<SignalRow[]> {
	// Candidate pool: published, not deleted, not the seed.
	// Signals:
	//  - shared subjects / levels (junction tables)
	//  - same resource_type / language
	//  - shared keyword tokens (comma-separated text field)
	//  - same created_by or normalized author label
	//  - co-occurrence in published collections
	//  - FTS ts_rank of candidate search_vector vs seed title+keywords
	// Catalog keywords count as keywords (ADR-0042).
	const candidateKeywords = sql`concat_ws(',', c.keywords, ${catalogLabelsSql(sql.raw("c.id"))})`;
	// Issue #485: una colección en borrador, en revisión o archivada todavía no
	// es pública y no debe influir en la ficha. Se comparte entre la señal y el
	// filtro de candidatos para que no se desalineen.
	const publishedCollectionPairs = sql`
		FROM collection_resources cr_seed
		INNER JOIN collections col
			ON col.id = cr_seed.collection_id
			AND col.editorial_status = 'published'
		INNER JOIN collection_resources cr_cand
			ON cr_cand.collection_id = cr_seed.collection_id
			AND cr_cand.resource_id = c.id
		WHERE cr_seed.resource_id = s.id
	`;
	const raw: unknown = await db.execute(sql`
		WITH seed AS (
			SELECT
				r.id,
				r.title,
				concat_ws(',', r.keywords, ${catalogLabelsSql(sql.raw("r.id"))}) AS keywords,
				r.resource_type,
				r.language,
				r.author,
				r.created_by,
				r.search_vector
			FROM resources r
			WHERE r.id = ${seedId}
				AND r.deleted_at IS NULL
		),
		seed_subjects AS (
			SELECT lower(rs.subject) AS subject
			FROM resource_subjects rs
			INNER JOIN seed s ON s.id = rs.resource_id
		),
		seed_levels AS (
			SELECT lower(rl.level) AS level
			FROM resource_levels rl
			INNER JOIN seed s ON s.id = rl.resource_id
		),
		seed_keywords AS (
			SELECT DISTINCT trim(both FROM lower(tok)) AS keyword
			FROM seed s
			CROSS JOIN LATERAL unnest(
				string_to_array(coalesce(s.keywords, ''), ',')
			) AS tok
			WHERE trim(both FROM lower(tok)) <> ''
		),
		seed_query AS (
			SELECT
				s.id,
				plainto_tsquery(
					'spanish'::regconfig,
					coalesce(s.title, '') || ' ' || coalesce(s.keywords, '')
				) AS tsq
			FROM seed s
		)
		SELECT
			c.id,
			c.slug,
			c.title,
			c.description,
			c.resource_type,
			c.language,
			c.license,
			c.author,
			c.editorial_status,
			c.validated_at,
			c.validation_source,
			c.updated_at,
			(
				SELECT count(*)::int
				FROM resource_subjects rs
				INNER JOIN seed_subjects ss ON ss.subject = lower(rs.subject)
				WHERE rs.resource_id = c.id
			) AS shared_subjects,
			(
				SELECT count(*)::int
				FROM resource_levels rl
				INNER JOIN seed_levels sl ON sl.level = lower(rl.level)
				WHERE rl.resource_id = c.id
			) AS shared_levels,
			CASE WHEN c.resource_type = s.resource_type THEN 1 ELSE 0 END AS same_resource_type,
			CASE WHEN c.language = s.language THEN 1 ELSE 0 END AS same_language,
			(
				SELECT count(*)::int
				FROM (
					SELECT DISTINCT trim(both FROM lower(tok)) AS keyword
					FROM unnest(string_to_array(${candidateKeywords}, ',')) AS tok
					WHERE trim(both FROM lower(tok)) <> ''
				) ck
				INNER JOIN seed_keywords sk ON sk.keyword = ck.keyword
			) AS shared_keywords,
			CASE
				WHEN s.created_by IS NOT NULL
					AND c.created_by IS NOT NULL
					AND s.created_by = c.created_by THEN 1
				WHEN s.author IS NOT NULL
					AND trim(s.author) <> ''
					AND c.author IS NOT NULL
					AND lower(regexp_replace(trim(c.author), '\\s+', ' ', 'g'))
						= lower(regexp_replace(trim(s.author), '\\s+', ' ', 'g'))
					THEN 1
				ELSE 0
			END AS same_author,
			(
				SELECT count(DISTINCT cr_seed.collection_id)::int
				${publishedCollectionPairs}
			) AS collection_cooccurrence,
			CASE
				WHEN c.search_vector IS NULL OR sq.tsq IS NULL THEN 0
				ELSE ts_rank(c.search_vector, sq.tsq, 32)
			END AS fts_rank
		FROM resources c
		CROSS JOIN seed s
		CROSS JOIN seed_query sq
		WHERE c.deleted_at IS NULL
			AND c.editorial_status = 'published'
			AND c.id <> s.id
			AND (
				EXISTS (
					SELECT 1
					FROM resource_subjects rs
					INNER JOIN seed_subjects ss ON ss.subject = lower(rs.subject)
					WHERE rs.resource_id = c.id
				)
				OR EXISTS (
					SELECT 1
					FROM resource_levels rl
					INNER JOIN seed_levels sl ON sl.level = lower(rl.level)
					WHERE rl.resource_id = c.id
				)
				OR c.resource_type = s.resource_type
				OR EXISTS (
					SELECT 1
					FROM (
						SELECT DISTINCT trim(both FROM lower(tok)) AS keyword
						FROM unnest(string_to_array(${candidateKeywords}, ',')) AS tok
						WHERE trim(both FROM lower(tok)) <> ''
					) ck
					INNER JOIN seed_keywords sk ON sk.keyword = ck.keyword
				)
				OR (
					s.created_by IS NOT NULL
					AND c.created_by IS NOT NULL
					AND s.created_by = c.created_by
				)
				OR (
					s.author IS NOT NULL
					AND trim(s.author) <> ''
					AND c.author IS NOT NULL
					AND lower(regexp_replace(trim(c.author), '\\s+', ' ', 'g'))
						= lower(regexp_replace(trim(s.author), '\\s+', ' ', 'g'))
				)
				OR EXISTS (
					SELECT 1
					${publishedCollectionPairs}
				)
				OR (
					c.search_vector IS NOT NULL
					AND sq.tsq IS NOT NULL
					AND c.search_vector @@ sq.tsq
				)
			)
	`);

	return rowsFromExecute<SignalRow>(raw);
}

function toCard(
	row: SignalRow,
	scored: ScoredCandidate<{
		id: string;
		slug: string;
		signals: RecommendationSignals;
	}>,
): RelatedResourceCard {
	return {
		id: row.id,
		slug: row.slug,
		title: row.title,
		description: row.description,
		resourceType: row.resource_type,
		language: row.language,
		license: row.license,
		author: row.author,
		editorialStatus: row.editorial_status,
		validatedAt: row.validated_at ?? null,
		validationSource: row.validation_source ?? null,
		updatedAt: row.updated_at,
		score: scored.score,
		signals: scored.signals,
		elpxPreview: null,
	};
}

/**
 * Resolve related resources for a seed resource id.
 * Returns empty lists when the seed is missing (caller may map to 404).
 */
export async function getRelatedResourcesById(
	db: DrizzleDB,
	seedId: string,
	rawLimit?: unknown,
): Promise<RelatedResourcesResult> {
	const limit = clampRelatedLimit(rawLimit);
	const rows = await loadRecommendationSignalRows(db, seedId);

	const byId = new Map(rows.map((row) => [row.id, row]));
	const rankInput = rows.map((row) => ({
		id: row.id,
		slug: row.slug,
		updatedAt: row.updated_at,
		signals: rowToSignals(row),
	}));

	// Rank with a higher ceiling so sameAuthor extras can be filled
	// from candidates that did not make the main related list.
	const allScored = rankRelatedCandidates(
		rankInput,
		Math.max(limit + SAME_AUTHOR_LIMIT, RELATED_POOL_CAP),
	);

	const relatedScored = allScored.slice(0, limit);
	const sameAuthorScored = pickSameAuthorExtras(
		relatedScored,
		allScored,
		SAME_AUTHOR_LIMIT,
	);

	const data: RelatedResourceCard[] = [];
	for (const scored of relatedScored) {
		const row = byId.get(scored.id);
		if (row) data.push(toCard(row, scored));
	}

	const sameAuthor: RelatedResourceCard[] = [];
	for (const scored of sameAuthorScored) {
		const row = byId.get(scored.id);
		if (row) sameAuthor.push(toCard(row, scored));
	}

	// Las tarjetas pintan la previsualización como en el listado (#426).
	const elpxMap = buildElpxMap(
		await listElpxProjectsByResourceIds(
			db,
			[...data, ...sameAuthor].map((card) => card.id),
		),
	);
	for (const card of [...data, ...sameAuthor]) {
		card.elpxPreview = buildElpxPreview(elpxMap.get(card.id));
	}

	return { data, sameAuthor, limit };
}

/**
 * Resolve related resources by public slug. Returns null if the resource
 * does not exist (caller → 404). Visibility is left to the route layer.
 */
export async function getRelatedResourcesBySlug(
	db: DrizzleDB,
	slug: string,
	rawLimit?: unknown,
): Promise<RelatedResourcesResult | null> {
	const seed = await db
		.select({
			id: resources.id,
			editorialStatus: resources.editorialStatus,
			deletedAt: resources.deletedAt,
		})
		.from(resources)
		.where(and(eq(resources.slug, slug), isNull(resources.deletedAt)))
		.limit(1);

	const row = seed[0];
	if (!row) return null;

	return getRelatedResourcesById(db, row.id, rawLimit);
}
