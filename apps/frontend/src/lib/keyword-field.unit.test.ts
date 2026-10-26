import { describe, expect, test } from "bun:test";
import { KEYWORD_MESSAGES } from "@procomun/db/keyword-catalog";
import type { CatalogKeyword } from "./api-client.ts";
import {
	addKeyword,
	keywordFieldNotice,
	moveHighlight,
} from "./keyword-field.ts";

const geo: CatalogKeyword = {
	id: "geometria",
	slug: "geometria",
	label: "Geometría",
};
const mat: CatalogKeyword = {
	id: "matematicas",
	slug: "matematicas",
	label: "Matemáticas",
};

describe("Campo de palabras clave (#384)", () => {
	test("añade una sugerencia y no repite la misma palabra clave", () => {
		const added = addKeyword([geo], mat);
		expect(added.selected).toEqual([geo, mat]);
		expect(added.message).toBeNull();

		const selected = [geo];
		const duplicate = addKeyword(selected, geo);
		expect(duplicate.selected).toBe(selected);
		expect(duplicate.message).toBeNull();
	});

	test("no añade una sexta y muestra el mensaje de máximo", () => {
		const five = [1, 2, 3, 4, 5].map((n) => ({
			id: `k${n}`,
			slug: `k${n}`,
			label: `Clave ${n}`,
		}));
		const result = addKeyword(five, geo);
		expect(result.selected).toBe(five);
		expect(result.message).toBe(KEYWORD_MESSAGES.max);
	});

	test("los avisos usan los textos literales de la issue", () => {
		const base = { query: "xyz", matchCount: 0, searching: false };
		expect(
			keywordFieldNotice({ ...base, selectedCount: 5, canCreate: true }),
		).toBe(KEYWORD_MESSAGES.max);
		expect(
			keywordFieldNotice({ ...base, selectedCount: 0, canCreate: false }),
		).toBe(KEYWORD_MESSAGES.empty);
		expect(
			keywordFieldNotice({ ...base, selectedCount: 0, canCreate: true }),
		).toBe(KEYWORD_MESSAGES.guidance);
		expect(
			keywordFieldNotice({
				...base,
				matchCount: 2,
				selectedCount: 0,
				canCreate: false,
			}),
		).toBeNull();
		expect(KEYWORD_MESSAGES.help).toBe(
			"Escribe para buscar y selecciona hasta 5 palabras clave del catálogo",
		);
	});

	test("el resaltado recorre las sugerencias en círculo", () => {
		expect(moveHighlight(0, -1, 3)).toBe(2);
		expect(moveHighlight(2, 1, 3)).toBe(0);
		expect(moveHighlight(0, 1, 0)).toBe(0);
	});
});
