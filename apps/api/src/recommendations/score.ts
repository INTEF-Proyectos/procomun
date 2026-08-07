/**
 * Pure recommendation scoring for related educational resources (ADR-0036).
 * Weights and combinators are side-effect free so unit tests can pin exact ranks.
 */

/** Configurable weights for each similarity signal. */
export type RecommendationWeights = {
	/** Points per shared subject. */
	subject: number;
	/** Points per shared educational level. */
	level: number;
	/** Points when resourceType matches. */
	resourceType: number;
	/** Points when language matches. */
	language: number;
	/** Points per shared keyword token. */
	keyword: number;
	/** Cap on how many keyword matches contribute. */
	maxKeywords: number;
	/** Points when same author / createdBy. */
	author: number;
	/** Points per co-occurring collection. */
	collection: number;
	/** Cap on collection co-occurrence contribution. */
	maxCollections: number;
	/** Multiplier for normalized FTS rank in [0, 1]. */
	fts: number;
};

/** Default weights from ADR-0036. */
export const DEFAULT_RECOMMENDATION_WEIGHTS: RecommendationWeights = {
	subject: 3,
	level: 2.5,
	resourceType: 2,
	language: 1,
	keyword: 1.5,
	maxKeywords: 5,
	author: 2,
	collection: 2.5,
	maxCollections: 3,
	fts: 4,
};

/** Feature vector computed for a candidate relative to a seed resource. */
export type RecommendationSignals = {
	sharedSubjects: number;
	sharedLevels: number;
	sameResourceType: boolean;
	sameLanguage: boolean;
	sharedKeywords: number;
	sameAuthor: boolean;
	collectionCooccurrence: number;
	/** Prefer 0–1 (e.g. ts_rank with normalization 32). Negative values are treated as 0. */
	ftsRank: number;
};

export type ScoredCandidate<T> = T & {
	score: number;
	signals: RecommendationSignals;
};

export const RELATED_LIMIT_DEFAULT = 6;
export const RELATED_LIMIT_MIN = 4;
export const RELATED_LIMIT_MAX = 8;
export const SAME_AUTHOR_LIMIT = 4;

/**
 * Clamp a requested related-list size to the product range [4, 8].
 * Non-finite or missing values fall back to the default (6).
 */
export function clampRelatedLimit(raw: unknown): number {
	const n =
		typeof raw === "number"
			? raw
			: typeof raw === "string" && raw.trim() !== ""
				? Number(raw)
				: Number.NaN;

	if (!Number.isFinite(n)) return RELATED_LIMIT_DEFAULT;
	return Math.min(
		RELATED_LIMIT_MAX,
		Math.max(RELATED_LIMIT_MIN, Math.trunc(n)),
	);
}

/**
 * Tokenize a free-text keywords field into a normalized unique set.
 * Splits on commas; trims; lowercases; drops empties and duplicates.
 */
export function tokenizeKeywords(
	keywords: string | null | undefined,
): string[] {
	if (typeof keywords !== "string" || keywords.trim() === "") return [];

	const seen = new Set<string>();
	const tokens: string[] = [];
	for (const part of keywords.split(",")) {
		const token = part.trim().toLowerCase();
		if (!token || seen.has(token)) continue;
		seen.add(token);
		tokens.push(token);
	}
	return tokens;
}

/** Count elements present in both lists (set intersection size). */
export function countShared(
	a: readonly string[],
	b: readonly string[],
): number {
	if (a.length === 0 || b.length === 0) return 0;
	const setB = new Set(b.map((x) => x.toLowerCase()));
	let count = 0;
	const seen = new Set<string>();
	for (const item of a) {
		const key = item.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		if (setB.has(key)) count += 1;
	}
	return count;
}

/**
 * Normalize author display names for equality: trim, collapse whitespace, lowercase.
 * Empty / null → null (no author signal).
 */
export function normalizeAuthorName(
	author: string | null | undefined,
): string | null {
	if (typeof author !== "string") return null;
	const collapsed = author.trim().replace(/\s+/g, " ").toLowerCase();
	return collapsed === "" ? null : collapsed;
}

/** True when createdBy ids match or normalized author labels match. */
export function authorsMatch(
	seed: { createdBy?: string | null; author?: string | null },
	candidate: { createdBy?: string | null; author?: string | null },
): boolean {
	if (
		seed.createdBy &&
		candidate.createdBy &&
		seed.createdBy === candidate.createdBy
	) {
		return true;
	}
	const a = normalizeAuthorName(seed.author);
	const b = normalizeAuthorName(candidate.author);
	return a !== null && b !== null && a === b;
}

/**
 * Compute the weighted recommendation score for a candidate.
 * Only non-negative contributions; FTS rank is clamped to [0, +∞) then multiplied.
 */
export function computeRecommendationScore(
	signals: RecommendationSignals,
	weights: RecommendationWeights = DEFAULT_RECOMMENDATION_WEIGHTS,
): number {
	const keywordHits = Math.min(
		Math.max(0, signals.sharedKeywords),
		weights.maxKeywords,
	);
	const collectionHits = Math.min(
		Math.max(0, signals.collectionCooccurrence),
		weights.maxCollections,
	);
	const fts = Math.max(0, signals.ftsRank);

	let score = 0;
	score += Math.max(0, signals.sharedSubjects) * weights.subject;
	score += Math.max(0, signals.sharedLevels) * weights.level;
	if (signals.sameResourceType) score += weights.resourceType;
	if (signals.sameLanguage) score += weights.language;
	score += keywordHits * weights.keyword;
	if (signals.sameAuthor) score += weights.author;
	score += collectionHits * weights.collection;
	score += fts * weights.fts;

	// Round to avoid floating noise in tests and JSON (2 decimals).
	return Math.round(score * 100) / 100;
}

export type RankableResource = {
	id: string;
	slug: string;
	updatedAt?: Date | string | number | null;
	signals: RecommendationSignals;
};

function updatedAtMs(value: RankableResource["updatedAt"]): number {
	if (value == null) return 0;
	if (value instanceof Date) return value.getTime();
	const t = new Date(value).getTime();
	return Number.isFinite(t) ? t : 0;
}

/**
 * Language alone is a weak boost — not enough to recommend.
 * A candidate needs at least one pedagogical/content signal.
 */
export function hasStrongRecommendationSignal(
	signals: RecommendationSignals,
): boolean {
	return (
		signals.sharedSubjects > 0 ||
		signals.sharedLevels > 0 ||
		signals.sharedKeywords > 0 ||
		signals.sameAuthor ||
		signals.collectionCooccurrence > 0 ||
		signals.ftsRank > 0 ||
		signals.sameResourceType
	);
}

/**
 * Attach scores, drop weak/zero-score rows, sort by score desc / recency / slug, limit.
 */
export function rankRelatedCandidates<T extends RankableResource>(
	candidates: readonly T[],
	limit: number,
	weights: RecommendationWeights = DEFAULT_RECOMMENDATION_WEIGHTS,
): Array<ScoredCandidate<T>> {
	const scored: Array<ScoredCandidate<T>> = [];
	for (const candidate of candidates) {
		if (!hasStrongRecommendationSignal(candidate.signals)) continue;
		const score = computeRecommendationScore(candidate.signals, weights);
		if (score <= 0) continue;
		scored.push({ ...candidate, score, signals: candidate.signals });
	}

	scored.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		const tb = updatedAtMs(b.updatedAt);
		const ta = updatedAtMs(a.updatedAt);
		if (tb !== ta) return tb - ta;
		return a.slug.localeCompare(b.slug);
	});

	const safeLimit = Math.max(0, Math.trunc(limit));
	return scored.slice(0, safeLimit);
}

/**
 * Build the “same author” strip: candidates with sameAuthor signal,
 * excluding ids already shown in the main related list.
 */
export function pickSameAuthorExtras<
	T extends ScoredCandidate<RankableResource>,
>(
	related: readonly T[],
	allScored: readonly T[],
	limit: number = SAME_AUTHOR_LIMIT,
): T[] {
	const shown = new Set(related.map((r) => r.id));
	const extras: T[] = [];
	for (const candidate of allScored) {
		if (extras.length >= limit) break;
		if (shown.has(candidate.id)) continue;
		if (!candidate.signals.sameAuthor) continue;
		extras.push(candidate);
	}
	return extras;
}
