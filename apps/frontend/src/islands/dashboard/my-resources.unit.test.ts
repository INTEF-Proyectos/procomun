import { describe, expect, test } from "bun:test";
import {
	EMPTY_MY_RESOURCES_FILTERS,
	EMPTY_STATUS_COUNTS,
	hasActiveFilters,
	MY_RESOURCES_PAGE_SIZE,
	myResourcesRequest,
	pageAfterDelete,
	pageOutOfRange,
} from "./my-resources.ts";

describe("myResourcesRequest (#530)", () => {
	test("traduce estado, texto, página y filtros a la petición de la API", () => {
		expect(
			myResourcesRequest(
				{
					...EMPTY_MY_RESOURCES_FILTERS,
					status: "review",
					query: "  fracciones ",
					resourceType: "video",
					tag: "geometria",
					knowledgeAreas: ["matematicas"],
				},
				3,
			),
		).toEqual({
			status: "review",
			q: "fracciones",
			limit: MY_RESOURCES_PAGE_SIZE,
			offset: 2 * MY_RESOURCES_PAGE_SIZE,
			resourceType: "video",
			tag: "geometria",
			educationalCategory: undefined,
			educationalOption: undefined,
			knowledgeAreas: ["matematicas"],
			professionalFamilies: [],
		});
	});

	test("«Todos» no manda estado y descarta familias sin Formación Profesional", () => {
		const request = myResourcesRequest(
			{
				...EMPTY_MY_RESOURCES_FILTERS,
				professionalFamilies: ["informatica"],
			},
			1,
		);
		expect(request.status).toBeUndefined();
		expect(request.q).toBeUndefined();
		expect(request.offset).toBe(0);
		expect(request.professionalFamilies).toEqual([]);
	});
});

describe("hasActiveFilters (#530)", () => {
	test("el estado no cuenta como filtro; el texto y los demás sí", () => {
		expect(hasActiveFilters(EMPTY_MY_RESOURCES_FILTERS)).toBeFalse();
		expect(
			hasActiveFilters({ ...EMPTY_MY_RESOURCES_FILTERS, status: "draft" }),
		).toBeFalse();
		expect(
			hasActiveFilters({ ...EMPTY_MY_RESOURCES_FILTERS, query: "a" }),
		).toBeTrue();
		expect(
			hasActiveFilters({
				...EMPTY_MY_RESOURCES_FILTERS,
				knowledgeAreas: ["matematicas"],
			}),
		).toBeTrue();
	});
});

describe("pageAfterDelete (#530)", () => {
	test("vuelve a la página anterior si se borra el último de la página", () => {
		expect(pageAfterDelete(3, 1)).toBe(2);
		expect(pageAfterDelete(3, 4)).toBe(3);
		expect(pageAfterDelete(1, 1)).toBe(1);
	});
});

describe("EMPTY_STATUS_COUNTS", () => {
	test("empieza a cero", () => {
		expect(EMPTY_STATUS_COUNTS.total).toBe(0);
	});
});

// Revisión de #580: si `total` baja por otro lado, no se queda en una página vacía.
describe("pageOutOfRange", () => {
	test("una página vacía más allá del final vuelve a la última con algo", () => {
		expect(pageOutOfRange(3, 0, 24)).toBe(2);
		expect(pageOutOfRange(5, 0, 25)).toBe(3);
		// Vacía pero dentro del rango: pedirla otra vez no arreglaría nada.
		expect(pageOutOfRange(3, 0, 25)).toBeNull();
	});

	test("deja la página si tiene recursos, es la primera o no hay nada", () => {
		expect(pageOutOfRange(3, 1, 25)).toBeNull();
		expect(pageOutOfRange(1, 0, 0)).toBeNull();
		expect(pageOutOfRange(2, 0, 0)).toBeNull();
	});
});
