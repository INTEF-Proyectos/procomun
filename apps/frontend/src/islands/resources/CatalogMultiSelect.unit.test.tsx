import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CatalogMultiSelect } from "./CatalogMultiSelect.tsx";
import {
	KnowledgeAreaField,
	ProfessionalFamilyField,
} from "./KnowledgeClassificationFields.tsx";

const catalog = {
	blocks: [
		{ id: "ciencias", label: "Ciencias, matemáticas y tecnología" },
		{ id: "lenguas-extranjeras", label: "Lenguas extranjeras" },
	],
	areas: [
		{ id: "quimica", label: "Química", blockId: "ciencias", active: true },
		{
			id: "ingles",
			label: "Inglés",
			blockId: "lenguas-extranjeras",
			active: true,
		},
		{ id: "ajedrez", label: "Ajedrez", blockId: "ciencias", active: false },
	],
	professionalFamilies: [
		{ id: "hosteleria-y-turismo", label: "Hostelería y Turismo" },
		{ id: "sanidad", label: "Sanidad" },
	],
};

describe("CatalogMultiSelect (#448)", () => {
	test("agrupa el campo con fieldset y legend, y etiqueta el buscador", () => {
		const html = renderToStaticMarkup(
			<CatalogMultiSelect
				id="ed-areas"
				legend="Áreas de conocimiento"
				searchLabel="Buscar un área"
				help="Elige hasta 3."
				options={[]}
				selected={[]}
				onChange={() => {}}
			/>,
		);
		expect(html).toContain("<fieldset");
		expect(html).toContain("<legend>Áreas de conocimiento</legend>");
		expect(html).toContain('for="ed-areas"');
		expect(html).toContain('role="combobox"');
		expect(html).toContain('aria-expanded="false"');
		expect(html).toContain(
			'aria-describedby="ed-areas-help ed-areas-notice ed-areas-error"',
		);
		// Sin selección no hay lista de elegidas.
		expect(html).not.toContain("<ul");
	});

	test("cada elegida se quita sola y el error se anuncia", () => {
		const html = renderToStaticMarkup(
			<CatalogMultiSelect
				id="ed-areas"
				legend="Áreas de conocimiento"
				searchLabel="Buscar un área"
				options={[]}
				selected={[
					{ id: "quimica", label: "Química", active: true },
					{ id: "ajedrez", label: "Ajedrez", active: false },
				]}
				onChange={() => {}}
				markInactive
				error="Selecciona al menos un área de conocimiento"
			/>,
		);
		expect(html).toContain('aria-label="Quitar Química"');
		expect(html).toContain('aria-label="Quitar Ajedrez"');
		expect(html).toContain("Ajedrez (inactiva)");
		expect(html).not.toContain("Química (inactiva)");
		expect(html).toContain('aria-invalid="true"');
		expect(html).toMatch(
			/id="ed-areas-error"[^>]*role="alert"[^>]*>Selecciona al menos un área de conocimiento</,
		);
	});
});

describe("campos de áreas y familias del formulario (#448)", () => {
	test("el campo de áreas explica el máximo y la regla de borrador", () => {
		const html = renderToStaticMarkup(
			<KnowledgeAreaField
				idPrefix="ed"
				catalog={catalog}
				selectedIds={["ajedrez"]}
				onChange={() => {}}
			/>,
		);
		expect(html).toContain("Áreas de conocimiento");
		expect(html).toContain("Elige hasta 3");
		expect(html).toContain("Ajedrez (inactiva)");
	});

	test("la familia profesional solo aparece con FP", () => {
		const withoutFp = renderToStaticMarkup(
			<ProfessionalFamilyField
				idPrefix="ed"
				catalog={catalog}
				categoryIds={["bachillerato"]}
				selectedIds={[]}
				onChange={() => {}}
			/>,
		);
		expect(withoutFp).not.toContain("<fieldset");
		// La región del aviso existe, vacía, para anunciarlo cuando aparezca.
		expect(withoutFp).toBe(
			'<p class="catalog-multiselect-warning" role="status"></p>',
		);

		const withFp = renderToStaticMarkup(
			<ProfessionalFamilyField
				idPrefix="ed"
				catalog={catalog}
				categoryIds={["formacion-profesional"]}
				selectedIds={["sanidad"]}
				onChange={() => {}}
			/>,
		);
		expect(withFp).toContain("<legend>Familia profesional</legend>");
		expect(withFp).toContain('aria-label="Quitar Sanidad"');
	});

	test("al quitar FP avisa de las familias que se borrarán al guardar", () => {
		const html = renderToStaticMarkup(
			<ProfessionalFamilyField
				idPrefix="ed"
				catalog={catalog}
				categoryIds={["bachillerato"]}
				selectedIds={["sanidad", "hosteleria-y-turismo"]}
				onChange={() => {}}
			/>,
		);
		expect(html).not.toContain("<fieldset");
		expect(html).toContain('role="status"');
		expect(html).toContain(
			"al guardar se eliminarán estas familias profesionales: Sanidad, Hostelería y Turismo.",
		);
	});
});
