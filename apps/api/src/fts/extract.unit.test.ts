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

	test("normalizeText preserves CR between content tokens", () => {
		// \r is kept (not a control drop) and is not compacted like spaces/tabs.
		expect(normalizeText("a\rb\r\nc")).toBe("a\rb\r\nc");
	});

	test("normalizeText preserves NBSP separators (Unicode whitespace)", () => {
		// NBSP matches /\s/u but is not collapsed to a plain space.
		expect(normalizeText("a\u00a0\u00a0b")).toBe("a\u00a0\u00a0b");
	});

	test("normalizeText trims trailing whitespace at the size limit", () => {
		const almost = `${"x".repeat(500 * 1024 - 10)}     `;
		const result = normalizeText(almost);
		expect(Buffer.byteLength(result, "utf-8")).toBeLessThanOrEqual(500 * 1024);
		expect(result.endsWith("x")).toBe(true);
		expect(/\s$/u.test(result)).toBe(false);
	});

	test("normalizeText drops over-limit pending whitespace and stops before more content", () => {
		const input = `${"y".repeat(500 * 1024 - 5)}     zzzzzz`;
		const result = normalizeText(input);
		expect(Buffer.byteLength(result, "utf-8")).toBeLessThanOrEqual(500 * 1024);
		expect(result).not.toContain("z");
		expect(result.endsWith("y")).toBe(true);
	});

	test("normalizeText does not emit a partial multi-byte character at the limit", () => {
		// U+1F600 is 4 UTF-8 bytes; leave only 2 free so it must not be appended.
		const prefix = "a".repeat(500 * 1024 - 2);
		const result = normalizeText(`${prefix}😀tail`);
		expect(Buffer.byteLength(result, "utf-8")).toBeLessThanOrEqual(500 * 1024);
		expect(result).not.toContain("😀");
		expect(result).not.toContain("tail");
		expect(result.endsWith("a")).toBe(true);
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
