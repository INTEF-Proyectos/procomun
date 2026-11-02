import { describe, expect, test } from "bun:test";
import {
	KEYWORD_AREA_REVIEW_CANDIDATES,
	KNOWLEDGE_AREA_BLOCKS,
	KNOWLEDGE_AREA_MESSAGES,
	KNOWLEDGE_AREA_SEED,
	MAX_KNOWLEDGE_AREAS,
	normalizeKnowledgeAreaKey,
	PROFESSIONAL_FAMILIES,
	validateKnowledgeAreaInput,
	validateKnowledgeAreaSelection,
	validateProfessionalFamilySelection,
} from "./knowledge-areas.ts";

describe("catálogo inicial de áreas de conocimiento (#448)", () => {
	test("tiene los 9 bloques fijos de la issue", () => {
		expect(KNOWLEDGE_AREA_BLOCKS.map((block) => block.label)).toEqual([
			"Artes y expresión artística",
			"Ciencias, matemáticas y tecnología",
			"Humanidades y ciencias sociales",
			"Educación física y deporte",
			"Lenguas y literatura",
			"Lenguas extranjeras",
			"Temas transversales",
			"Empresa y orientación profesional",
			"Inclusión educativa, tutoría y valores",
		]);
	});

	test("tiene las 55 áreas de la issue más Química", () => {
		expect(KNOWLEDGE_AREA_SEED).toHaveLength(56);
		const quimica = KNOWLEDGE_AREA_SEED.find((area) => area.id === "quimica");
		expect(quimica).toEqual({
			id: "quimica",
			label: "Química",
			blockId: "ciencias",
		});
		const byBlock = Object.fromEntries(
			KNOWLEDGE_AREA_BLOCKS.map((block) => [
				block.id,
				KNOWLEDGE_AREA_SEED.filter((area) => area.blockId === block.id).length,
			]),
		);
		expect(byBlock).toEqual({
			artes: 6,
			ciencias: 11,
			humanidades: 8,
			"educacion-fisica": 1,
			lenguas: 6,
			"lenguas-extranjeras": 4,
			transversales: 9,
			empresa: 3,
			inclusion: 8,
		});
	});

	test("ELE va en «Inclusión educativa, tutoría y valores»", () => {
		expect(KNOWLEDGE_AREA_SEED.find((area) => area.id === "ele")).toEqual({
			id: "ele",
			label: "ELE (Español como Lengua Extranjera)",
			blockId: "inclusion",
		});
	});

	test("ids y denominaciones normalizadas únicos", () => {
		const ids = KNOWLEDGE_AREA_SEED.map((area) => area.id);
		expect(new Set(ids).size).toBe(ids.length);
		const keys = KNOWLEDGE_AREA_SEED.map((area) =>
			normalizeKnowledgeAreaKey(area.label),
		);
		expect(new Set(keys).size).toBe(keys.length);
	});

	test("las 28 familias profesionales oficiales, sin repetir", () => {
		expect(PROFESSIONAL_FAMILIES).toHaveLength(28);
		const ids = PROFESSIONAL_FAMILIES.map((family) => family.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(PROFESSIONAL_FAMILIES.map((family) => family.label)).toContain(
			"Inteligencia Artificial y Data",
		);
	});

	test("los candidatos a revisar apuntan a áreas que existen", () => {
		const ids = new Set(KNOWLEDGE_AREA_SEED.map((area) => area.id));
		for (const areaIds of Object.values(KEYWORD_AREA_REVIEW_CANDIDATES)) {
			for (const id of areaIds) expect(ids.has(id)).toBe(true);
		}
	});
});

describe("validación de áreas y selecciones (#448)", () => {
	test("el alta exige denominación y un bloque existente", () => {
		expect(
			validateKnowledgeAreaInput({ label: " ", blockId: "artes" }),
		).toEqual({
			ok: false,
			message: KNOWLEDGE_AREA_MESSAGES.labelRequired,
		});
		expect(
			validateKnowledgeAreaInput({ label: "Cine", blockId: "nuevo" }),
		).toEqual({ ok: false, message: KNOWLEDGE_AREA_MESSAGES.unknownBlock });
		expect(
			validateKnowledgeAreaInput({
				label: "  Cine   y  series ",
				description: " ",
				blockId: "artes",
			}),
		).toEqual({
			ok: true,
			value: { label: "Cine y series", description: null, blockId: "artes" },
		});
	});

	test("la edición acepta cambios parciales", () => {
		expect(
			validateKnowledgeAreaInput({ blockId: "humanidades" }, true),
		).toEqual({
			ok: true,
			value: { blockId: "humanidades" },
		});
	});

	test(`como máximo ${MAX_KNOWLEDGE_AREAS} áreas, sin repetir`, () => {
		expect(validateKnowledgeAreaSelection(["a", "b", "c"])).toEqual({
			ok: true,
			ids: ["a", "b", "c"],
		});
		expect(validateKnowledgeAreaSelection(["a", "b", "c", "d"])).toEqual({
			ok: false,
			message: KNOWLEDGE_AREA_MESSAGES.max,
		});
		expect(validateKnowledgeAreaSelection(["a", "a"])).toEqual({
			ok: false,
			message: KNOWLEDGE_AREA_MESSAGES.duplicateSelection,
		});
		expect(validateKnowledgeAreaSelection("a")).toEqual({
			ok: false,
			message: KNOWLEDGE_AREA_MESSAGES.invalidList,
		});
	});

	test("las familias solo se admiten en recursos de FP", () => {
		expect(
			validateProfessionalFamilySelection(["sanidad"], ["educacion-primaria"]),
		).toEqual({ ok: false, message: KNOWLEDGE_AREA_MESSAGES.familyRequiresFp });
		expect(
			validateProfessionalFamilySelection(
				["sanidad", "hosteleria-y-turismo"],
				["formacion-profesional"],
			),
		).toEqual({ ok: true, ids: ["sanidad", "hosteleria-y-turismo"] });
		expect(validateProfessionalFamilySelection([], [])).toEqual({
			ok: true,
			ids: [],
		});
		expect(
			validateProfessionalFamilySelection(
				["inventada"],
				["formacion-profesional"],
			),
		).toEqual({ ok: false, message: KNOWLEDGE_AREA_MESSAGES.unknownFamily });
	});
});
