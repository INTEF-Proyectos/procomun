import { describe, expect, test } from "bun:test";
import {
	categoryHasEducationalOptions,
	EDUCATIONAL_CATEGORIES,
	normalizeEducationalAssignments,
	validateEducationalAssignments,
} from "./educational-areas.ts";

describe("catálogo de categorización educativa", () => {
	test("tiene las 12 categorías y las opciones exactas, sin segundo selector ficticio", () => {
		expect(EDUCATIONAL_CATEGORIES.map((category) => category.label)).toEqual([
			"Educación Infantil",
			"Educación Primaria",
			"Educación Secundaria Obligatoria",
			"Bachillerato",
			"Formación Profesional",
			"PDC - Programa de Diversificación Curricular",
			"ELE - Español como Lengua Extranjera",
			"Educación Especial",
			"Educación de Personas Adultas",
			"Enseñanzas Universitarias",
			"Enseñanzas de Régimen Especial",
			"Formación del Profesorado",
		]);

		const byId = new Map(
			EDUCATIONAL_CATEGORIES.map((category) => [category.id, category]),
		);
		expect(
			byId.get("educacion-infantil")?.options.map((option) => option.label),
		).toEqual(["Primer ciclo (0-3 años)", "Segundo ciclo (3-6 años)"]);
		expect(
			byId.get("educacion-primaria")?.options.map((option) => option.label),
		).toEqual([
			"Primer tramo (1.º, 2.º y 3.º)",
			"Segundo tramo (4.º, 5.º y 6.º)",
		]);
		expect(
			byId
				.get("educacion-secundaria-obligatoria")
				?.options.map((option) => option.label),
		).toEqual(["1.º y 2.º de ESO", "3.º y 4.º de ESO"]);
		expect(
			byId.get("formacion-profesional")?.options.map((option) => option.label),
		).toEqual(["Grado básico", "Grado medio", "Grado superior"]);
		expect(byId.get("pdc")?.options.map((option) => option.label)).toEqual([
			"Ámbito lingüístico y social",
			"Ámbito científico-tecnológico",
			"Otro ámbito",
		]);
		expect(byId.get("ele")?.options.map((option) => option.label)).toEqual([
			"Básico",
			"Medio",
			"Avanzado",
		]);
		expect(
			byId
				.get("ensenanzas-regimen-especial")
				?.options.map((option) => option.label),
		).toEqual([
			"Música",
			"Artes plásticas y diseño",
			"Danza",
			"Enseñanzas deportivas",
			"Arte dramático",
			"Idiomas",
		]);

		for (const id of [
			"bachillerato",
			"educacion-especial",
			"educacion-personas-adultas",
			"ensenanzas-universitarias",
			"formacion-profesorado",
		]) {
			expect(categoryHasEducationalOptions(id)).toBe(false);
		}

		const labels = EDUCATIONAL_CATEGORIES.flatMap((category) => [
			category.label,
			...category.options.map((option) => option.label),
		]);
		expect(labels).not.toContain("Sin segundo selector");
		expect(labels).not.toContain("Sin asignar");
		expect(labels).not.toContain("No se aplica");
		expect(
			new Set(EDUCATIONAL_CATEGORIES.map((category) => category.id)).size,
		).toBe(12);
	});

	test("rechaza opción sin categoría, Bachillerato+Básico y duplicados", () => {
		expect(
			validateEducationalAssignments([{ optionId: "basico" }]).map(
				(issue) => issue.message,
			),
		).toContain(
			"La opción secundaria no puede guardarse sin su categoría principal",
		);

		expect(
			validateEducationalAssignments([
				{ categoryId: "bachillerato", optionId: "basico" },
			]).some((issue) =>
				issue.message.includes("combinación de categoría y opción no existe"),
			),
		).toBe(true);

		expect(
			validateEducationalAssignments([
				{ categoryId: "ele", optionId: "basico" },
				{ categoryId: "ele", optionId: "basico" },
			]).some((issue) => issue.message.includes("duplicada")),
		).toBe(true);

		expect(
			validateEducationalAssignments([
				{ categoryId: "educacion-primaria", optionId: null },
				{ categoryId: "educacion-primaria", optionId: "primer-tramo" },
			]).length,
		).toBeGreaterThan(0);
	});

	test("acepta solo categoría, varias opciones y varias categorías", () => {
		expect(
			normalizeEducationalAssignments([
				{ categoryId: "bachillerato" },
				{ categoryId: "educacion-secundaria-obligatoria", optionId: "eso-3-4" },
				{
					categoryId: "pdc",
					optionId: "ambito-linguistico-social",
				},
				{ categoryId: "pdc", optionId: "otro-ambito" },
			]),
		).toEqual([
			{ categoryId: "bachillerato", optionId: null },
			{
				categoryId: "educacion-secundaria-obligatoria",
				optionId: "eso-3-4",
			},
			{ categoryId: "pdc", optionId: "ambito-linguistico-social" },
			{ categoryId: "pdc", optionId: "otro-ambito" },
		]);
	});
});
