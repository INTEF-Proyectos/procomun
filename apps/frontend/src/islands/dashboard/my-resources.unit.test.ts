import { describe, expect, test } from "bun:test";
import {
	EMPTY_MY_RESOURCES_FILTERS,
	EMPTY_STATUS_COUNTS,
	hasActiveFilters,
	MY_RESOURCES_PAGE_SIZE,
	myResourcesRequest,
	pageAfterDelete,
	statusBadge,
	statusFilterOptions,
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

describe("statusFilterOptions (#530)", () => {
	test("ofrece los cuatro estados con su contador y «Todos» con el total", () => {
		const options = statusFilterOptions({
			draft: 2,
			review: 1,
			published: 5,
			archived: 0,
			total: 8,
		});
		expect(options.map((o) => o.value)).toEqual([
			"",
			"published",
			"draft",
			"review",
			"archived",
		]);
		expect(options.map((o) => o.label)).toEqual([
			"Todos (8)",
			"Publicados (5)",
			"Borradores (2)",
			"En revisión (1)",
			"Archivados (0)",
		]);
	});

	test("los contadores de los estados suman el de «Todos»", () => {
		const counts = {
			draft: 3,
			review: 4,
			published: 2,
			archived: 1,
			total: 10,
		};
		const options = statusFilterOptions(counts);
		const sum = options
			.filter((o) => o.value !== "")
			.reduce((acc, o) => acc + o.count, 0);
		expect(sum).toBe(options[0]?.count ?? -1);
	});
});

describe("statusBadge (#530)", () => {
	test("marca borrador, revisión y archivado; lo publicado no lleva insignia", () => {
		expect(statusBadge("draft")).toEqual({
			text: "Borrador",
			variant: "draft",
		});
		expect(statusBadge("review")).toEqual({
			text: "En revisión",
			variant: "review",
		});
		expect(statusBadge("archived")).toEqual({
			text: "Archivado",
			variant: "tertiary",
		});
		expect(statusBadge("published")).toBeNull();
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
