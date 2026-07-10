import { describe, expect, it } from "bun:test";
import { normalizeLanguage } from "./normalize-language.ts";

describe("normalizeLanguage", () => {
	it("accepts a directly valid ISO 639-1 code", () => {
		expect(normalizeLanguage(["es"])).toEqual({ language: "es", guessed: false });
		expect(normalizeLanguage(["ca"])).toEqual({ language: "ca", guessed: false });
	});

	it("normalizes case and regional suffixes", () => {
		expect(normalizeLanguage(["ES"])).toEqual({ language: "es", guessed: false });
		expect(normalizeLanguage(["pt-BR"])).toEqual({ language: "pt", guessed: false });
	});

	it("maps ISO 639-2 aliases seen in legacy metadata", () => {
		expect(normalizeLanguage(["spa"])).toEqual({ language: "es", guessed: false });
		expect(normalizeLanguage(["cat"])).toEqual({ language: "ca", guessed: false });
	});

	it("falls through to the next candidate when the first is empty", () => {
		expect(normalizeLanguage(["", "es"])).toEqual({ language: "es", guessed: false });
	});

	it("falls back to Spanish and marks it as guessed when nothing matches", () => {
		expect(normalizeLanguage(["xx"])).toEqual({ language: "es", guessed: true });
		expect(normalizeLanguage(null)).toEqual({ language: "es", guessed: true });
		expect(normalizeLanguage([])).toEqual({ language: "es", guessed: true });
		expect(normalizeLanguage([null, undefined, ""])).toEqual({ language: "es", guessed: true });
	});
});
