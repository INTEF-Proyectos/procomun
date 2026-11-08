import { describe, expect, test } from "bun:test";
import {
	addCatalogSelection,
	catalogAreaOptions,
	familiesPendingRemoval,
	familiesToSave,
	familyFilterFor,
	flattenOptionGroups,
	formAreaOptions,
	knowledgeAreaHref,
	matchCatalogOptions,
	professionalFamilyHref,
	selectedCatalogOptions,
	showsProfessionalFamilies,
} from "./knowledge-area-field.ts";
import { url } from "./paths.ts";

const groups = [
	{ id: "ciencias", label: "Ciencias, matemáticas y tecnología" },
	{ id: "lenguas", label: "Lenguas y literatura" },
];
const areas = [
	{ id: "fisica", label: "Física", blockId: "ciencias", active: true },
	{ id: "quimica", label: "Química", blockId: "ciencias", active: true },
	{
		id: "lengua-espanola-y-literatura",
		label: "Lengua Española y Literatura",
		blockId: "lenguas",
		active: true,
	},
	{ id: "ajedrez", label: "Ajedrez", blockId: "ciencias", active: false },
];

describe("búsqueda en el catálogo de áreas (#448)", () => {
	test("sin texto ofrece todo, agrupado en el orden de los bloques", () => {
		const result = matchCatalogOptions(formAreaOptions(areas, []), groups, {
			query: "",
			excludeIds: [],
		});
		expect(result.map((group) => group.label)).toEqual([
			"Ciencias, matemáticas y tecnología",
			"Lenguas y literatura",
		]);
		expect(result[0]?.options.map((option) => option.id)).toEqual([
			"fisica",
			"quimica",
		]);
	});

	test("busca sin mayúsculas ni tildes y quita las elegidas y los grupos vacíos", () => {
		const options = formAreaOptions(areas, []);
		expect(
			matchCatalogOptions(options, groups, { query: "QUIMI", excludeIds: [] }),
		).toEqual([
			{
				id: "ciencias",
				label: "Ciencias, matemáticas y tecnología",
				options: [
					{
						id: "quimica",
						label: "Química",
						groupId: "ciencias",
						active: true,
					},
				],
			},
		]);
		expect(
			matchCatalogOptions(options, groups, {
				query: "espanola",
				excludeIds: ["lengua-espanola-y-literatura"],
			}),
		).toEqual([]);
	});

	test("las flechas recorren las opciones en el orden de los bloques", () => {
		const groupsFound = matchCatalogOptions(
			formAreaOptions(areas, []),
			groups,
			{
				query: "",
				excludeIds: ["quimica"],
			},
		);
		expect(flattenOptionGroups(groupsFound).map((option) => option.id)).toEqual(
			["fisica", "lengua-espanola-y-literatura"],
		);
	});

	test("sin grupos devuelve una sola lista (familias profesionales)", () => {
		const families = [
			{ id: "sanidad", label: "Sanidad" },
			{ id: "agraria", label: "Agraria" },
		];
		expect(
			matchCatalogOptions(families, undefined, {
				query: "sani",
				excludeIds: [],
			}),
		).toEqual([
			{ id: "", label: "", options: [{ id: "sanidad", label: "Sanidad" }] },
		]);
	});

	test("el formulario no ofrece las desactivadas salvo si el recurso ya las tiene", () => {
		expect(formAreaOptions(areas, []).map((area) => area.id)).not.toContain(
			"ajedrez",
		);
		expect(
			formAreaOptions(areas, ["ajedrez"]).map((area) => area.id),
		).toContain("ajedrez");
	});

	test("las elegidas llevan su denominación y si están inactivas", () => {
		expect(
			selectedCatalogOptions(
				["ajedrez", "fisica", "borrada"],
				catalogAreaOptions(areas),
				[{ id: "borrada", label: "Área del recurso" }],
			),
		).toEqual([
			{ id: "ajedrez", label: "Ajedrez", groupId: "ciencias", active: false },
			{ id: "fisica", label: "Física", groupId: "ciencias", active: true },
			{ id: "borrada", label: "Área del recurso" },
		]);
	});
});

describe("selección de áreas (#448)", () => {
	test("añade sin repetir y avisa al llegar al máximo", () => {
		expect(addCatalogSelection(["fisica"], "quimica", 3)).toEqual({
			selected: ["fisica", "quimica"],
			limitReached: false,
		});
		const same = ["fisica"];
		expect(addCatalogSelection(same, "fisica", 3).selected).toBe(same);
		expect(addCatalogSelection(["a", "b", "c"], "d", 3)).toEqual({
			selected: ["a", "b", "c"],
			limitReached: true,
		});
		expect(addCatalogSelection(["a", "b", "c"], "d").selected).toEqual([
			"a",
			"b",
			"c",
			"d",
		]);
	});
});

describe("familias profesionales en el formulario (#448)", () => {
	test("solo aparecen con Formación Profesional", () => {
		expect(showsProfessionalFamilies(["formacion-profesional"])).toBe(true);
		expect(showsProfessionalFamilies(["bachillerato"])).toBe(false);
	});

	test("al quitar FP se avisa y no se guardan", () => {
		expect(familiesPendingRemoval(["bachillerato"], ["sanidad"])).toBe(true);
		expect(familiesPendingRemoval(["formacion-profesional"], ["sanidad"])).toBe(
			false,
		);
		expect(familiesPendingRemoval(["bachillerato"], [])).toBe(false);
		expect(familiesToSave(["bachillerato"], ["sanidad"])).toEqual([]);
		expect(familiesToSave(["formacion-profesional"], ["sanidad"])).toEqual([
			"sanidad",
		]);
	});

	test("la ficha enlaza al buscador filtrado por área o por FP y familia", () => {
		expect(knowledgeAreaHref("quimica")).toBe(
			url("explorar?knowledgeAreas=quimica"),
		);
		expect(professionalFamilyHref("sanidad")).toBe(
			url(
				"explorar?educationalCategory=formacion-profesional&professionalFamilies=sanidad",
			),
		);
	});

	test("el buscador limpia las familias si la etapa no es FP", () => {
		expect(familyFilterFor("formacion-profesional", ["sanidad"])).toEqual([
			"sanidad",
		]);
		expect(familyFilterFor("bachillerato", ["sanidad"])).toEqual([]);
		expect(familyFilterFor("", ["sanidad"])).toEqual([]);
		expect(familyFilterFor(undefined, undefined)).toEqual([]);
	});
});
