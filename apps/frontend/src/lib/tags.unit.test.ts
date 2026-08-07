import { describe, expect, test } from "bun:test";
import { formatTagsInput, parseTagsInput, tagSlugClient } from "./tags.ts";

describe("frontend tags helpers (#76)", () => {
	test("parseTagsInput splits and de-duplicates case-insensitively", () => {
		expect(parseTagsInput("mates, Mates, física")).toEqual(["mates", "física"]);
	});

	test("formatTagsInput joins with comma-space", () => {
		expect(formatTagsInput(["a", "b"])).toBe("a, b");
	});

	test("tagSlugClient matches server-style slugify", () => {
		expect(tagSlugClient("Matemáticas")).toBe("matematicas");
		expect(tagSlugClient("!!!")).toBe("etiqueta");
	});
});
