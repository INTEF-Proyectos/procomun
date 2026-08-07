import { describe, expect, test } from "bun:test";
import {
	findSimilarTags,
	levenshteinDistance,
	normalizeTagLabel,
	parseKeywordString,
	tagSlugFromLabel,
} from "./normalize.ts";

describe("parseKeywordString", () => {
	test("splits comma-separated keywords and trims whitespace", () => {
		expect(parseKeywordString("mates,  física , química")).toEqual([
			"mates",
			"física",
			"química",
		]);
	});

	test("also accepts semicolon and pipe separators", () => {
		expect(parseKeywordString("IA; robótica | taller")).toEqual([
			"IA",
			"robótica",
			"taller",
		]);
	});

	test("drops empty segments and collapses internal spaces in a token", () => {
		expect(parseKeywordString("  , a  b ,  ,c")).toEqual(["a b", "c"]);
	});

	test("returns empty array for nullish or blank input", () => {
		expect(parseKeywordString(null)).toEqual([]);
		expect(parseKeywordString(undefined)).toEqual([]);
		expect(parseKeywordString("   ")).toEqual([]);
		expect(parseKeywordString("")).toEqual([]);
	});
});

describe("normalizeTagLabel", () => {
	test("trims, collapses spaces, and preserves meaningful casing of first occurrence shape", () => {
		expect(normalizeTagLabel("  Matemáticas   aplicadas ")).toBe(
			"Matemáticas aplicadas",
		);
	});

	test("rejects empty labels", () => {
		expect(normalizeTagLabel("   ")).toBeNull();
		expect(normalizeTagLabel("")).toBeNull();
	});

	test("enforces max length", () => {
		const long = "a".repeat(120);
		expect(normalizeTagLabel(long)?.length).toBe(100);
	});
});

describe("tagSlugFromLabel", () => {
	test("slugifies spanish accents and punctuation", () => {
		expect(tagSlugFromLabel("Matemáticas (ESO)")).toBe("matematicas-eso");
		expect(tagSlugFromLabel("TIC / tecnología")).toBe("tic-tecnologia");
	});

	test("falls back to etiqueta when slug would be empty", () => {
		expect(tagSlugFromLabel("!!!")).toBe("etiqueta");
		expect(tagSlugFromLabel("@@@")).toBe("etiqueta");
	});
});

describe("levenshteinDistance", () => {
	test("is zero for identical strings", () => {
		expect(levenshteinDistance("mates", "mates")).toBe(0);
	});

	test("counts single edits", () => {
		expect(levenshteinDistance("mates", "mate")).toBe(1);
		expect(levenshteinDistance("casa", "caza")).toBe(1);
	});

	test("is symmetric", () => {
		expect(levenshteinDistance("matematicas", "matematica")).toBe(
			levenshteinDistance("matematica", "matematicas"),
		);
	});
});

describe("findSimilarTags", () => {
	const catalog = [
		{ id: "1", label: "Matemáticas", slug: "matematicas" },
		{ id: "2", label: "Matematicas", slug: "matematicas-dup" },
		{ id: "3", label: "Física", slug: "fisica" },
		{ id: "4", label: "Historia", slug: "historia" },
	];

	test("suggests near-duplicates by slug/label distance", () => {
		const similar = findSimilarTags(catalog, {
			label: "Matematicas",
			slug: "matematicas",
			maxDistance: 2,
			limit: 5,
		});
		expect(similar.map((t) => t.id)).toContain("1");
		expect(similar.map((t) => t.id)).toContain("2");
		expect(similar.map((t) => t.id)).not.toContain("4");
	});

	test("excludes the same tag id when provided", () => {
		const similar = findSimilarTags(catalog, {
			label: "Matemáticas",
			slug: "matematicas",
			excludeId: "1",
			maxDistance: 2,
		});
		expect(similar.map((t) => t.id)).not.toContain("1");
		expect(similar.length).toBeGreaterThan(0);
	});

	test("returns empty when nothing is close enough", () => {
		expect(
			findSimilarTags(catalog, {
				label: "Astronomía cuántica",
				slug: "astronomia-cuantica",
				maxDistance: 1,
			}),
		).toEqual([]);
	});
});
