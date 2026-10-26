import { describe, expect, test } from "bun:test";
import {
	KEYWORD_MESSAGES,
	keywordIndex,
	matchLegacyLabels,
	normalizeKeywordKey,
	searchKeywordCatalog,
	validateKeywordSelection,
} from "./keyword-catalog.ts";

const CATALOG = [
	{
		id: "geometria",
		slug: "geometria",
		label: "Geometría",
		aliases: ["ángulos"],
	},
	{
		id: "proyectos",
		slug: "proyectos",
		label: "Aprendizaje basado en proyectos",
		aliases: ["ABP"],
	},
	{
		id: "problemas",
		slug: "problemas",
		label: "Aprendizaje basado en problemas",
		aliases: ["ABP"],
	},
	{
		id: "fracciones",
		slug: "fracciones",
		label: "Fracciones",
		aliases: [],
	},
	{
		id: "calculo",
		slug: "calculo",
		label: "Cálculo y resolución de problemas",
		aliases: ["fracciones"],
	},
];

describe("catálogo de palabras clave (#384)", () => {
	test("normaliza mayúsculas, tildes, almohadillas y espacios", () => {
		expect(normalizeKeywordKey("  #Geometría   Plana ")).toBe(
			"geometria plana",
		);
	});

	test("ignora tildes y antepone la denominación al alias", () => {
		expect(searchKeywordCatalog(" geometria ", CATALOG)).toEqual([
			{
				id: "geometria",
				slug: "geometria",
				label: "Geometría",
				match: "label",
			},
		]);
		expect(searchKeywordCatalog("angulos", CATALOG)[0]?.match).toBe("alias");
		expect(
			searchKeywordCatalog("fracciones", CATALOG).map((item) => item.id),
		).toEqual(["fracciones", "calculo"]);
	});

	test("un alias ambiguo devuelve todas sus opciones", () => {
		const abp = searchKeywordCatalog("abp", CATALOG);
		expect(abp.map((item) => item.id).sort()).toEqual([
			"problemas",
			"proyectos",
		]);
		expect(abp.every((item) => item.match === "alias")).toBe(true);
		expect(searchKeywordCatalog("   ", CATALOG)).toEqual([]);
	});

	test("valida la forma de la selección", () => {
		expect(validateKeywordSelection(["a", "b"])).toEqual({
			ok: true,
			ids: ["a", "b"],
		});
		expect(validateKeywordSelection(["a", "b", "c", "d", "e", "f"])).toEqual({
			ok: false,
			message: KEYWORD_MESSAGES.max,
		});
		expect(validateKeywordSelection(["a", "a"]).ok).toBe(false);
		expect(validateKeywordSelection("a").ok).toBe(false);
		expect(validateKeywordSelection([1]).ok).toBe(false);
	});
});

describe("correspondencia de etiquetas antiguas (#384, apartado 5)", () => {
	const index = keywordIndex(CATALOG);

	test("asigna por identidad y por alias, sin repetir", () => {
		expect(
			matchLegacyLabels(["#Geometría", "ángulos", "GEOMETRIA"], index),
		).toEqual({ ids: ["geometria"], unmatched: [], ambiguous: [] });
	});

	test("la denominación gana al alias y el alias ambiguo va a revisión", () => {
		expect(
			matchLegacyLabels(["fracciones", "ABP", "Scratch", " "], index),
		).toEqual({
			ids: ["fracciones"],
			unmatched: ["Scratch"],
			ambiguous: ["ABP"],
		});
	});
});
