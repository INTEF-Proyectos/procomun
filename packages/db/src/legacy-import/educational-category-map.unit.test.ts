import { describe, expect, test } from "bun:test";
import { getEducationalCategory } from "../educational-areas.ts";
import {
	assertLegacyCategoryDestinations,
	LEGACY_EDUCATIONAL_CATEGORY_RULES,
	mapLegacyEducationalCategories,
	summarizeLegacyEducationalImport,
} from "./educational-category-map.ts";

const EXPECTED: Array<[string, string, string | null]> = [
	["Educación Infantil", "educacion-infantil", null],
	["Educación Primaria", "educacion-primaria", null],
	["6 -7 años / Primer curso", "educacion-primaria", "primer-tramo"],
	["7 - 8 años / Segundo curso", "educacion-primaria", "primer-tramo"],
	["8 - 9 años / Tercer curso", "educacion-primaria", "primer-tramo"],
	["9 - 10 años / Cuarto curso", "educacion-primaria", "segundo-tramo"],
	["10 - 11 años / Quinto curso", "educacion-primaria", "segundo-tramo"],
	["11 - 12 / Sexto curso", "educacion-primaria", "segundo-tramo"],
	[
		"Educación Secundaria Obligatoria",
		"educacion-secundaria-obligatoria",
		null,
	],
	[
		"12 - 13 años / Primer curso",
		"educacion-secundaria-obligatoria",
		"eso-1-2",
	],
	[
		"13 - 14 años / Segundo curso",
		"educacion-secundaria-obligatoria",
		"eso-1-2",
	],
	[
		"14 - 15 años / Tercer curso",
		"educacion-secundaria-obligatoria",
		"eso-3-4",
	],
	["15 - 16 / Cuarto curso", "educacion-secundaria-obligatoria", "eso-3-4"],
	["Bachillerato", "bachillerato", null],
	["Formación Profesional", "formacion-profesional", null],
	[
		"Formación Profesional Básica (más de 15 años)",
		"formacion-profesional",
		"grado-basico",
	],
	[
		"Ciclo formativo grado medio (más de 16 años)",
		"formacion-profesional",
		"grado-medio",
	],
	[
		"Ciclo formativo grado superior (más de 18 años)",
		"formacion-profesional",
		"grado-superior",
	],
	["Educación Especial", "educacion-especial", null],
	["Educación de Personas Adultas", "educacion-personas-adultas", null],
	["Formación del Profesorado", "formacion-profesorado", null],
	["Enseñanzas Universitarias", "ensenanzas-universitarias", null],
	["Enseñanzas de música", "ensenanzas-regimen-especial", "musica"],
	[
		"Enseñanzas de artes plásticas y diseño",
		"ensenanzas-regimen-especial",
		"artes-plasticas-diseno",
	],
	["Enseñanzas de danza", "ensenanzas-regimen-especial", "danza"],
	[
		"Enseñanzas deportivas",
		"ensenanzas-regimen-especial",
		"ensenanzas-deportivas",
	],
	[
		"Enseñanzas de arte dramático",
		"ensenanzas-regimen-especial",
		"arte-dramatico",
	],
	["Enseñanza oficial de idiomas", "ensenanzas-regimen-especial", "idiomas"],
	["Nivel básico (A)", "ele", "basico"],
	["Nivel intermedio (B)", "ele", "medio"],
	["Nivel avanzado ( C )", "ele", "avanzado"],
];

describe("correspondencia de categorías antiguas", () => {
	test("aplica las 31 correspondencias y el destino existe en el catálogo", () => {
		expect(LEGACY_EDUCATIONAL_CATEGORY_RULES).toHaveLength(31);
		expect(EXPECTED).toHaveLength(31);
		assertLegacyCategoryDestinations();

		for (const [source, categoryId, optionId] of EXPECTED) {
			const mapped = mapLegacyEducationalCategories([source]);
			expect(mapped.unrecognized).toEqual([]);
			expect(mapped.assignments).toEqual([{ categoryId, optionId }]);
			const category = getEducationalCategory(categoryId);
			expect(category).not.toBeNull();
			if (optionId) {
				expect(category?.options.some((option) => option.id === optionId)).toBe(
					true,
				);
			}
		}
	});

	test("reconoce variantes de escritura sin crear otra clasificación", () => {
		const variants = [
			"  formación del profesorado ",
			"Educación secundaria Obligatoria",
			"educación primaria",
			"Enseñanza Oficial de Idiomas",
			"educación especial",
			"Nivel avanzado (C)",
			"Nivel avanzado ( C )",
			"6 – 7 años / Primer curso",
			"Educación Infantil (1.234)",
		];
		expect(
			mapLegacyEducationalCategories([variants[0] ?? ""]).assignments,
		).toEqual([{ categoryId: "formacion-profesorado", optionId: null }]);
		expect(
			mapLegacyEducationalCategories([variants[1] ?? ""]).assignments,
		).toEqual([
			{
				categoryId: "educacion-secundaria-obligatoria",
				optionId: null,
			},
		]);
		expect(
			mapLegacyEducationalCategories([variants[2] ?? ""]).assignments,
		).toEqual([{ categoryId: "educacion-primaria", optionId: null }]);
		expect(
			mapLegacyEducationalCategories([variants[3] ?? ""]).assignments,
		).toEqual([
			{
				categoryId: "ensenanzas-regimen-especial",
				optionId: "idiomas",
			},
		]);
		expect(
			mapLegacyEducationalCategories([variants[4] ?? ""]).assignments,
		).toEqual([{ categoryId: "educacion-especial", optionId: null }]);
		expect(
			mapLegacyEducationalCategories([variants[5] ?? ""]).assignments,
		).toEqual([{ categoryId: "ele", optionId: "avanzado" }]);
		expect(
			mapLegacyEducationalCategories([variants[6] ?? ""]).assignments,
		).toEqual([{ categoryId: "ele", optionId: "avanzado" }]);
		expect(
			mapLegacyEducationalCategories([variants[7] ?? ""]).assignments,
		).toEqual([{ categoryId: "educacion-primaria", optionId: "primer-tramo" }]);
		expect(
			mapLegacyEducationalCategories([variants[8] ?? ""]).assignments,
		).toEqual([{ categoryId: "educacion-infantil", optionId: null }]);
	});

	test("no usa coincidencias parciales ni asigna PDC", () => {
		const mapped = mapLegacyEducationalCategories([
			"Primer curso",
			"PDC - Programa de Diversificación Curricular",
			"Ámbito lingüístico y social",
		]);
		expect(mapped.assignments).toEqual([]);
		expect(mapped.unrecognized).toEqual([
			"Primer curso",
			"PDC - Programa de Diversificación Curricular",
			"Ámbito lingüístico y social",
		]);
	});

	test("colapsa la categoría general si hay un tramo y conserva tramos distintos", () => {
		expect(
			mapLegacyEducationalCategories([
				"Educación Primaria",
				"10 - 11 años / Quinto curso",
				"Educación Primaria",
			]).assignments,
		).toEqual([
			{ categoryId: "educacion-primaria", optionId: "segundo-tramo" },
		]);
		expect(
			mapLegacyEducationalCategories([
				"8 - 9 años / Tercer curso",
				"9 - 10 años / Cuarto curso",
			]).assignments,
		).toEqual([
			{ categoryId: "educacion-primaria", optionId: "primer-tramo" },
			{ categoryId: "educacion-primaria", optionId: "segundo-tramo" },
		]);
	});

	test("conserva idiomas y ELE a la vez y no inventa clasificación si no hay categorías", () => {
		expect(
			mapLegacyEducationalCategories([
				"Enseñanza oficial de idiomas",
				"Nivel básico (A)",
			]).assignments,
		).toEqual([
			{ categoryId: "ele", optionId: "basico" },
			{ categoryId: "ensenanzas-regimen-especial", optionId: "idiomas" },
		]);
		expect(mapLegacyEducationalCategories([]).empty).toBe(true);
		expect(mapLegacyEducationalCategories(["  "]).assignments).toEqual([]);
	});

	test("una categoría no reconocida no descarta las que sí tienen regla", () => {
		const mapped = mapLegacyEducationalCategories([
			"Bachillerato",
			"Taller de robótica",
			"Taller de robótica",
		]);
		expect(mapped.assignments).toEqual([
			{ categoryId: "bachillerato", optionId: null },
		]);
		expect(mapped.unrecognized).toEqual(["Taller de robótica"]);
	});

	test("el informe cuenta recursos únicos, no la suma de categorías", () => {
		const informe = summarizeLegacyEducationalImport([
			{
				externalId: "r1",
				sourceCategories: ["Educación Primaria", "10 - 11 años / Quinto curso"],
			},
			{
				externalId: "r2",
				sourceCategories: ["Nivel intermedio (B)", "Categoría inventada"],
			},
			{ externalId: "r3", sourceCategories: [] },
			{
				externalId: "r2",
				sourceCategories: ["Nivel intermedio (B)", "Categoría inventada"],
			},
		]);
		expect(informe.recursosConTodasTransformadas).toBe(1);
		expect(informe.recursosPendientesDeRevision).toBe(1);
		expect(informe.recursosSinCategorizacionDeOrigen).toBe(1);
		expect(informe.categoriasNoReconocidas).toEqual([
			{ categoria: "Categoría inventada", recursos: ["r2"] },
		]);
	});
});
