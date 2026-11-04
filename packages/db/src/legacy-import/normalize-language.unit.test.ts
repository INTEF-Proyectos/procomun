import { describe, expect, it } from "bun:test";
import { normalizeLanguage } from "./normalize-language.ts";

describe("normalizeLanguage", () => {
	it("accepts a directly valid ISO 639-1 code", () => {
		expect(normalizeLanguage(["es"])).toBe("es");
		expect(normalizeLanguage(["ca"])).toBe("ca");
	});

	it("normalizes case and regional suffixes", () => {
		expect(normalizeLanguage(["ES"])).toBe("es");
		expect(normalizeLanguage(["pt-BR"])).toBe("pt");
		expect(normalizeLanguage(["ca-valencia"])).toBe("ca");
	});

	it("maps ISO 639-2 aliases seen in legacy metadata", () => {
		expect(normalizeLanguage(["spa"])).toBe("es");
		expect(normalizeLanguage(["cat"])).toBe("ca");
	});

	it("maps the legacy Valencian code «va» to Catalan (issue #473)", () => {
		expect(normalizeLanguage(["va"])).toBe("ca");
	});

	it("falls through to the next candidate when the first is empty", () => {
		expect(normalizeLanguage(["", "es"])).toBe("es");
	});

	it("returns null instead of assuming Spanish when nothing matches (issue #473)", () => {
		expect(normalizeLanguage(["xx"])).toBeNull();
		expect(normalizeLanguage(null)).toBeNull();
		expect(normalizeLanguage([])).toBeNull();
		expect(normalizeLanguage([null, undefined, ""])).toBeNull();
	});
});
