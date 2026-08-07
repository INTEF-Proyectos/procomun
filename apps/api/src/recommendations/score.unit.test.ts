import { describe, expect, test } from "bun:test";
import {
	authorsMatch,
	clampRelatedLimit,
	computeRecommendationScore,
	countShared,
	DEFAULT_RECOMMENDATION_WEIGHTS,
	normalizeAuthorName,
	pickSameAuthorExtras,
	RELATED_LIMIT_DEFAULT,
	RELATED_LIMIT_MAX,
	RELATED_LIMIT_MIN,
	type RecommendationSignals,
	rankRelatedCandidates,
	tokenizeKeywords,
} from "./score.ts";

function signals(
	partial: Partial<RecommendationSignals> = {},
): RecommendationSignals {
	return {
		sharedSubjects: 0,
		sharedLevels: 0,
		sameResourceType: false,
		sameLanguage: false,
		sharedKeywords: 0,
		sameAuthor: false,
		collectionCooccurrence: 0,
		ftsRank: 0,
		...partial,
	};
}

describe("tokenizeKeywords", () => {
	test("splits on commas, trims, lowercases and dedupes", () => {
		expect(
			tokenizeKeywords(" Geometría , Áreas,  geometría ,ángulos "),
		).toEqual(["geometría", "áreas", "ángulos"]);
	});

	test("returns empty array for null, undefined and blank input", () => {
		expect(tokenizeKeywords(null)).toEqual([]);
		expect(tokenizeKeywords(undefined)).toEqual([]);
		expect(tokenizeKeywords("")).toEqual([]);
		expect(tokenizeKeywords("   ,  , ")).toEqual([]);
	});
});

describe("countShared", () => {
	test("counts intersection case-insensitively without double-counting", () => {
		expect(
			countShared(
				["Matemáticas", "matemáticas", "Física"],
				["matemáticas", "Historia"],
			),
		).toBe(1);
	});

	test("returns 0 when either side is empty", () => {
		expect(countShared([], ["a"])).toBe(0);
		expect(countShared(["a"], [])).toBe(0);
	});
});

describe("normalizeAuthorName / authorsMatch", () => {
	test("normalizes whitespace and case", () => {
		expect(normalizeAuthorName("  Ana   Pérez ")).toBe("ana pérez");
		expect(normalizeAuthorName("   ")).toBeNull();
		expect(normalizeAuthorName(null)).toBeNull();
	});

	test("matches by createdBy id", () => {
		expect(
			authorsMatch(
				{ createdBy: "user-1", author: "A" },
				{ createdBy: "user-1", author: "B" },
			),
		).toBe(true);
	});

	test("matches by normalized author label when ids differ", () => {
		expect(
			authorsMatch(
				{ createdBy: "u1", author: "Ana Pérez" },
				{ createdBy: "u2", author: "  ana   pérez " },
			),
		).toBe(true);
	});

	test("does not match when both sides lack author identity", () => {
		expect(authorsMatch({ author: null }, { author: "" })).toBe(false);
		expect(
			authorsMatch({ createdBy: "a" }, { createdBy: "b", author: null }),
		).toBe(false);
	});
});

describe("clampRelatedLimit", () => {
	test("defaults for missing or non-numeric input", () => {
		expect(clampRelatedLimit(undefined)).toBe(RELATED_LIMIT_DEFAULT);
		expect(clampRelatedLimit(null)).toBe(RELATED_LIMIT_DEFAULT);
		expect(clampRelatedLimit("")).toBe(RELATED_LIMIT_DEFAULT);
		expect(clampRelatedLimit("nope")).toBe(RELATED_LIMIT_DEFAULT);
		expect(clampRelatedLimit(Number.NaN)).toBe(RELATED_LIMIT_DEFAULT);
	});

	test("clamps below min and above max", () => {
		expect(clampRelatedLimit(1)).toBe(RELATED_LIMIT_MIN);
		expect(clampRelatedLimit(3)).toBe(RELATED_LIMIT_MIN);
		expect(clampRelatedLimit(4)).toBe(4);
		expect(clampRelatedLimit(6)).toBe(6);
		expect(clampRelatedLimit(8)).toBe(RELATED_LIMIT_MAX);
		expect(clampRelatedLimit(99)).toBe(RELATED_LIMIT_MAX);
	});

	test("truncates floats toward zero before clamping", () => {
		expect(clampRelatedLimit(5.9)).toBe(5);
		expect(clampRelatedLimit("7.2")).toBe(7);
	});
});

describe("computeRecommendationScore", () => {
	const w = DEFAULT_RECOMMENDATION_WEIGHTS;

	test("returns 0 when no signals fire", () => {
		expect(computeRecommendationScore(signals())).toBe(0);
	});

	test("applies subject and level weights additively", () => {
		// 2 subjects * 3 + 1 level * 2.5 = 6 + 2.5 = 8.5
		expect(
			computeRecommendationScore(
				signals({ sharedSubjects: 2, sharedLevels: 1 }),
			),
		).toBe(8.5);
	});

	test("awards fixed points for type and language", () => {
		expect(
			computeRecommendationScore(
				signals({ sameResourceType: true, sameLanguage: true }),
			),
		).toBe(w.resourceType + w.language);
	});

	test("caps keyword contributions at maxKeywords", () => {
		const uncapped = computeRecommendationScore(
			signals({ sharedKeywords: 10 }),
			{ ...w, maxKeywords: 5 },
		);
		// 5 * 1.5 = 7.5
		expect(uncapped).toBe(7.5);

		const exactCap = computeRecommendationScore(signals({ sharedKeywords: 5 }));
		expect(exactCap).toBe(7.5);
	});

	test("caps collection co-occurrence at maxCollections", () => {
		// 3 * 2.5 = 7.5 even if 9 collections co-occur
		expect(
			computeRecommendationScore(signals({ collectionCooccurrence: 9 })),
		).toBe(7.5);
	});

	test("multiplies FTS rank by fts weight and ignores negatives", () => {
		// 0.25 * 4 = 1
		expect(computeRecommendationScore(signals({ ftsRank: 0.25 }))).toBe(1);
		expect(computeRecommendationScore(signals({ ftsRank: -3 }))).toBe(0);
	});

	test("combines all signals into a single known total", () => {
		// subjects 1*3=3, levels 1*2.5=2.5, type 2, lang 1, keywords 2*1.5=3,
		// author 2, collections 1*2.5=2.5, fts 0.5*4=2
		// total = 3+2.5+2+1+3+2+2.5+2 = 18
		expect(
			computeRecommendationScore(
				signals({
					sharedSubjects: 1,
					sharedLevels: 1,
					sameResourceType: true,
					sameLanguage: true,
					sharedKeywords: 2,
					sameAuthor: true,
					collectionCooccurrence: 1,
					ftsRank: 0.5,
				}),
			),
		).toBe(18);
	});
});

describe("rankRelatedCandidates", () => {
	test("drops zero-score and language-only candidates; sorts by score then recency then slug", () => {
		const ranked = rankRelatedCandidates(
			[
				{
					id: "c",
					slug: "c-low",
					updatedAt: "2026-01-01T00:00:00.000Z",
					signals: signals({ sharedSubjects: 1 }), // score 3
				},
				{
					id: "a",
					slug: "a-high",
					updatedAt: "2026-01-01T00:00:00.000Z",
					signals: signals({ sharedSubjects: 2 }), // score 6
				},
				{
					id: "b",
					slug: "b-zero",
					updatedAt: "2026-06-01T00:00:00.000Z",
					signals: signals(), // score 0 → dropped
				},
				{
					id: "lang",
					slug: "lang-only",
					updatedAt: "2026-12-01T00:00:00.000Z",
					signals: signals({ sameLanguage: true }), // weak → dropped
				},
				{
					id: "d",
					slug: "d-tie-newer",
					updatedAt: "2026-03-01T00:00:00.000Z",
					signals: signals({ sharedSubjects: 1 }), // score 3, newer than c
				},
				{
					id: "e",
					slug: "e-tie-same-day-slug",
					updatedAt: "2026-03-01T00:00:00.000Z",
					signals: signals({ sharedSubjects: 1 }), // score 3, same day as d, slug after d
				},
			],
			10,
		);

		expect(ranked.map((r) => r.slug)).toEqual([
			"a-high",
			"d-tie-newer",
			"e-tie-same-day-slug",
			"c-low",
		]);
		expect(ranked[0]?.score).toBe(6);
		expect(ranked.every((r) => r.score > 0)).toBe(true);
		expect(ranked.some((r) => r.slug === "lang-only")).toBe(false);
	});

	test("respects limit after sorting", () => {
		const ranked = rankRelatedCandidates(
			[
				{ id: "1", slug: "one", signals: signals({ sharedSubjects: 3 }) },
				{ id: "2", slug: "two", signals: signals({ sharedSubjects: 2 }) },
				{ id: "3", slug: "three", signals: signals({ sharedSubjects: 1 }) },
			],
			2,
		);
		expect(ranked).toHaveLength(2);
		expect(ranked[0]?.slug).toBe("one");
		expect(ranked[1]?.slug).toBe("two");
	});
});

describe("pickSameAuthorExtras", () => {
	test("returns same-author candidates not already in related, up to limit", () => {
		const all = rankRelatedCandidates(
			[
				{
					id: "r1",
					slug: "related-main",
					signals: signals({ sharedSubjects: 2, sameAuthor: true }),
				},
				{
					id: "r2",
					slug: "author-extra-a",
					signals: signals({ sameAuthor: true }),
				},
				{
					id: "r3",
					slug: "author-extra-b",
					signals: signals({ sameAuthor: true }),
				},
				{
					id: "r4",
					slug: "other",
					signals: signals({ sharedSubjects: 1 }),
				},
			],
			10,
		);

		const related = all.filter((r) => r.id === "r1");
		const extras = pickSameAuthorExtras(related, all, 2);

		expect(extras.map((e) => e.slug)).toEqual([
			"author-extra-a",
			"author-extra-b",
		]);
		expect(extras).toHaveLength(2);
		expect(extras.every((e) => e.signals.sameAuthor)).toBe(true);
		expect(extras.some((e) => e.id === "r1")).toBe(false);
	});
});
