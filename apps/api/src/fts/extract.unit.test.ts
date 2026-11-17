/**
 * Tests for text extraction module.
 * Main extraction tests are co-located in search.unit.test.ts for shared DB setup.
 */
import { describe, expect, test } from "bun:test";
import {
	extractTextFromHtml,
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

	test("normalizeText collapses runs of spaces into a single one", () => {
		expect(normalizeText("a   b")).toBe("a b");
	});

	test("normalizeText turns tabs into a single space", () => {
		expect(normalizeText("a\t\t\tb")).toBe("a b");
	});

	test("normalizeText collapses mixed runs of spaces and tabs", () => {
		expect(normalizeText("a \t \t b")).toBe("a b");
	});

	test("normalizeText keeps two blank lines but collapses longer runs", () => {
		// Two newlines are a paragraph break and survive; anything beyond is noise.
		expect(normalizeText("a\n\nb")).toBe("a\n\nb");
		expect(normalizeText("a\n\n\nb")).toBe("a\n\nb");
		expect(normalizeText("a\n\n\n\n\n\nb")).toBe("a\n\nb");
	});

	test("normalizeText trims leading and trailing whitespace", () => {
		expect(normalizeText("   a   ")).toBe("a");
		expect(normalizeText("\n\n  a\t\t")).toBe("a");
	});

	test("normalizeText drops control characters but keeps tab, LF and CR", () => {
		// NUL, SOH and DEL are stripped outright; \t is still compacted to a space.
		expect(normalizeText("a\u0000\u0001b\u007fc")).toBe("abc");
		expect(normalizeText("a\tb\nc\rd")).toBe("a b\nc\rd");
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

	// #446: el cuerpo de los artículos legacy llega como HTML en el JSON y se
	// guarda para la búsqueda igual que el texto de un .html subido.
	test("extractTextFromHtml deja solo el texto, sin scripts y con las entidades resueltas", () => {
		const result = extractTextFromHtml(
			'<p>Descripci&oacute;n  del <strong>aula</strong>\n\n\n\nfinal.<img src="http://imagenes.ejemplo.test/a.jpg" onerror="alert(1)" /></p><script>alert(\'x\')</script><style>p{}</style>',
		);
		expect(result).toBe("Descripción del aula\n\nfinal.");
	});

	test("extractTextFromHtml devuelve cadena vacía si no hay texto", () => {
		expect(extractTextFromHtml("<img src='x'><script>1</script>")).toBe("");
	});
});
