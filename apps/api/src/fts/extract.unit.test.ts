/**
 * Tests for text extraction module.
 * Main extraction tests are co-located in search.unit.test.ts for shared DB setup.
 */
import { describe, expect, test } from "bun:test";
import {
	isSupportedForExtraction,
	normalizeText,
	stripHtml,
} from "./extract.ts";

describe("Extract module — unit helpers", () => {
	test("isSupportedForExtraction covers all supported extensions", () => {
		const supported = [".txt", ".md", ".csv", ".html", ".htm", ".pdf", ".docx"];
		for (const ext of supported) {
			expect(isSupportedForExtraction(`file${ext}`)).toBe(true);
		}
	});

	test("isSupportedForExtraction rejects common unsupported types", () => {
		const unsupported = [".png", ".jpg", ".mp4", ".zip", ".exe", ".scorm"];
		for (const ext of unsupported) {
			expect(isSupportedForExtraction(`file${ext}`)).toBe(false);
		}
	});

	test("isSupportedForExtraction rejects filenames without extension", () => {
		expect(isSupportedForExtraction("README")).toBe(false);
		expect(isSupportedForExtraction("Makefile")).toBe(false);
	});

	test("normalizeText handles empty string", () => {
		expect(normalizeText("")).toBe("");
	});

	test("normalizeText handles whitespace-only input", () => {
		expect(normalizeText("   \n\n   ")).toBe("");
	});

	test("stripHtml handles empty string", () => {
		const result = stripHtml("");
		expect(result).toBe("");
	});

	test("stripHtml handles plain text without HTML", () => {
		const result = stripHtml("Just plain text");
		expect(result).toContain("Just plain text");
	});
});
