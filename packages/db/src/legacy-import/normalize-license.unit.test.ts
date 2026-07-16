import { describe, expect, it } from "bun:test";
import { normalizeLicense } from "./normalize-license.ts";

describe("normalizeLicense", () => {
	it("maps a plain attribution + share alike string (es_2024052212_9181312 style)", () => {
		const result = normalizeLicense(
			"creative commons: attribution - share alike 4.0",
		);
		expect(result).toEqual({
			license: "cc-by-sa",
			matched: true,
			rawInput: "creative commons: attribution - share alike 4.0",
		});
	});

	it("maps attribution + non commercial + share alike (1676602802114 style)", () => {
		const result = normalizeLicense(
			"creative commons: attribution - non commercial - share alike",
		);
		expect(result.matched).toBe(true);
		expect(result.license).toBe("cc-by-nc-sa");
	});

	it("maps bare attribution to cc-by", () => {
		const result = normalizeLicense("creative commons: attribution");
		expect(result).toEqual({
			license: "cc-by",
			matched: true,
			rawInput: "creative commons: attribution",
		});
	});

	it("maps cc0 / public domain variants", () => {
		expect(normalizeLicense("CC0").license).toBe("cc0");
		expect(normalizeLicense("dominio público").license).toBe("cc0");
	});

	it("rejects the invalid non-derived + share-alike combination (es_2025101012_9102834 style)", () => {
		const result = normalizeLicense(
			"creative commons: attribution - non derived work - non commercial - share alike",
		);
		expect(result.matched).toBe(false);
		expect(result.license).toBeNull();
	});

	it("rejects non-Creative-Commons text as a blocking case", () => {
		const result = normalizeLicense("todos los derechos reservados");
		expect(result.matched).toBe(false);
		expect(result.license).toBeNull();
	});

	it("rejects Creative Commons text without attribution", () => {
		const result = normalizeLicense("creative commons: share alike");
		expect(result.matched).toBe(false);
	});

	it("treats empty/null input as not matched", () => {
		expect(normalizeLicense("").matched).toBe(false);
		expect(normalizeLicense(null).matched).toBe(false);
		expect(normalizeLicense(undefined).matched).toBe(false);
	});

	it("ignores version suffixes", () => {
		const withVersion = normalizeLicense(
			"creative commons: attribution - share alike 3.0",
		);
		const withoutVersion = normalizeLicense(
			"creative commons: attribution - share alike",
		);
		expect(withVersion.license).toBe(withoutVersion.license);
	});
});
