/**
 * Tests for FTS barrel index module.
 * Verifies all public exports are accessible.
 */
import { describe, expect, test } from "bun:test";
import * as fts from "./index.ts";

describe("FTS index — barrel exports", () => {
	test("exports extractTextFromFile", () => {
		expect(typeof fts.extractTextFromFile).toBe("function");
	});

	test("exports isSupportedForExtraction", () => {
		expect(typeof fts.isSupportedForExtraction).toBe("function");
	});

	test("exports normalizeText", () => {
		expect(typeof fts.normalizeText).toBe("function");
	});

	test("exports searchResources", () => {
		expect(typeof fts.searchResources).toBe("function");
	});

	test("exports updateSearchVector", () => {
		expect(typeof fts.updateSearchVector).toBe("function");
	});

	test("exports reindexResource", () => {
		expect(typeof fts.reindexResource).toBe("function");
	});

	test("exports reindexAllResources", () => {
		expect(typeof fts.reindexAllResources).toBe("function");
	});

	test("exports enqueueExtraction", () => {
		expect(typeof fts.enqueueExtraction).toBe("function");
	});

	test("exports resetUnaccentCache", () => {
		expect(typeof fts.resetUnaccentCache).toBe("function");
	});
});
