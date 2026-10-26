import { describe, expect, test } from "bun:test";
import {
	EDUCATIONAL_CATEGORIES,
	EDUCATIONAL_CATEGORY_LABEL,
	EDUCATIONAL_OPTION_LABEL,
	EDUCATIONAL_SECTION_TITLE,
} from "@procomun/db/educational-areas";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EducationalClassificationList } from "../islands/catalog/EducationalClassificationList.tsx";
import { EducationalSearchFilters } from "../islands/catalog/EducationalSearchFilters.tsx";
import { EducationalClassificationEditor } from "../islands/resources/EducationalClassificationFields.tsx";
import {
	addEducationalCategory,
	applyEducationalFilterChange,
	assignmentsToSelections,
	classificationLineText,
	formatEducationalClassifications,
	removeEducationalCategory,
	sanitizeEducationalFilter,
	selectionsToAssignments,
	toggleEducationalOption,
} from "./educational-classification.ts";

describe("categorización educativa en formulario, ficha y buscador", () => {
	test("quitar una categoría elimina sus opciones y conserva las demás", () => {
		const selections = toggleEducationalOption(
			toggleEducationalOption(
				addEducationalCategory(
					addEducationalCategory([], "educacion-secundaria-obligatoria"),
					"pdc",
				),
				"educacion-secundaria-obligatoria",
				"eso-3-4",
			),
			"pdc",
			"ambito-linguistico-social",
		);
		const remaining = removeEducationalCategory(
			selections,
			"educacion-secundaria-obligatoria",
		);
		expect(selectionsToAssignments(remaining)).toEqual([
			{ categoryId: "pdc", optionId: "ambito-linguistico-social" },
		]);
		expect(
			selectionsToAssignments(
				addEducationalCategory(remaining, "bachillerato"),
			),
		).toEqual([
			{ categoryId: "pdc", optionId: "ambito-linguistico-social" },
			{ categoryId: "bachillerato", optionId: null },
		]);
	});

	test("recuperar asignaciones no rellena todas las opciones si no hay segundo nivel", () => {
		const selections = assignmentsToSelections([
			{ categoryId: "educacion-primaria", optionId: null },
			{ categoryId: "ele", optionId: "basico" },
			{ categoryId: "ele", optionId: "avanzado" },
		]);
		expect(selections).toEqual([
			{ categoryId: "educacion-primaria", optionIds: [] },
			{ categoryId: "ele", optionIds: ["basico", "avanzado"] },
		]);
	});

	test("la ficha usa las mismas etiquetas del catálogo y no expande la categoría sola", () => {
		const lines = formatEducationalClassifications([
			{ categoryId: "ensenanzas-regimen-especial", optionId: "musica" },
			{
				categoryId: "educacion-secundaria-obligatoria",
				optionId: "eso-3-4",
			},
			{ categoryId: "bachillerato", optionId: null },
		]);
		expect(lines.map(classificationLineText)).toEqual([
			"Educación Secundaria Obligatoria: 3.º y 4.º de ESO",
			"Bachillerato",
			"Enseñanzas de Régimen Especial: Música",
		]);
		expect(lines.map((line) => line.categoryLabel)).toEqual(
			EDUCATIONAL_CATEGORIES.filter((category) =>
				[
					"educacion-secundaria-obligatoria",
					"bachillerato",
					"ensenanzas-regimen-especial",
				].includes(category.id),
			).map((category) => category.label),
		);
	});

	test("cambiar la categoría del buscador limpia la opción y se puede limpiar solo la opción", () => {
		const withMusic = applyEducationalFilterChange(
			{ categoryId: "", optionId: "" },
			{ categoryId: "ensenanzas-regimen-especial" },
		);
		const music = applyEducationalFilterChange(withMusic, {
			optionId: "musica",
		});
		expect(music).toEqual({
			categoryId: "ensenanzas-regimen-especial",
			optionId: "musica",
		});
		expect(
			applyEducationalFilterChange(music, { categoryId: "educacion-primaria" }),
		).toEqual({ categoryId: "educacion-primaria", optionId: "" });
		expect(applyEducationalFilterChange(music, { optionId: "" })).toEqual({
			categoryId: "ensenanzas-regimen-especial",
			optionId: "",
		});
		expect(
			applyEducationalFilterChange(music, { categoryId: "bachillerato" }),
		).toEqual({ categoryId: "bachillerato", optionId: "" });
		expect(sanitizeEducationalFilter("bachillerato", "basico")).toEqual({
			categoryId: "bachillerato",
			optionId: "",
		});
	});

	test("el formulario, la ficha y el buscador muestran el mismo catálogo", () => {
		const editor = renderToStaticMarkup(
			createElement(EducationalClassificationEditor, {
				idPrefix: "edu",
				selections: [
					{ categoryId: "bachillerato", optionIds: [] },
					{ categoryId: "pdc", optionIds: ["otro-ambito"] },
				],
				onChange: () => {},
			}),
		);
		expect(editor).toContain(EDUCATIONAL_SECTION_TITLE);
		expect(editor).toContain(EDUCATIONAL_CATEGORY_LABEL);
		expect(editor).toContain(EDUCATIONAL_OPTION_LABEL);
		expect(editor).toContain("Otro ámbito");
		expect(editor).toContain("Bachillerato");
		expect(editor).not.toContain("Sin segundo selector");
		expect(editor).not.toContain('type="text"');
		// Un fieldset por categoría, con su nombre como leyenda.
		expect(editor).toContain("<legend>Bachillerato</legend>");
		expect(editor).toContain(
			"<legend>PDC - Programa de Diversificación Curricular</legend>",
		);
		expect(editor).not.toContain(
			`<legend>${EDUCATIONAL_OPTION_LABEL}</legend>`,
		);
		expect(editor).toContain("Quitar Bachillerato");

		const detail = renderToStaticMarkup(
			createElement(EducationalClassificationList, {
				areas: [
					{ categoryId: "ele", optionId: "avanzado" },
					{ categoryId: "educacion-especial", optionId: null },
				],
			}),
		);
		// Cada valor es un enlace de búsqueda (#459); el texto no cambia.
		expect(detail.replace(/<[^>]+>/g, "")).toContain(
			"ELE - Español como Lengua Extranjera: Avanzado",
		);
		expect(detail).toContain("Educación Especial");
		expect(detail).not.toContain("Básico");

		const filters = renderToStaticMarkup(
			createElement(EducationalSearchFilters, {
				categoryId: "",
				optionId: "",
				onChange: () => {},
			}),
		);
		for (const category of EDUCATIONAL_CATEGORIES) {
			expect(filters).toContain(category.label);
		}
		expect(filters).not.toContain('id="filter-educational-option"');

		const primaria = renderToStaticMarkup(
			createElement(EducationalSearchFilters, {
				categoryId: "educacion-primaria",
				optionId: "",
				onChange: () => {},
			}),
		);
		expect(primaria).toContain('id="filter-educational-option"');
		expect(primaria).toContain("Primer ciclo (1.º y 2.º)");
		expect(primaria).toContain("Segundo ciclo (3.º y 4.º)");
		expect(primaria).toContain("Tercer ciclo (5.º y 6.º)");

		const bachillerato = renderToStaticMarkup(
			createElement(EducationalSearchFilters, {
				categoryId: "bachillerato",
				optionId: "",
				onChange: () => {},
			}),
		);
		expect(bachillerato).not.toContain('id="filter-educational-option"');
	});
});
