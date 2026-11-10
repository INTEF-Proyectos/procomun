import { describe, expect, mock, test } from "bun:test";

import {
	buildListingUrl,
	readListingState,
	writeListingStateToHistory,
} from "./listing-history.ts";

describe("listing history helpers", () => {
	test("builds listing URL with query and page", () => {
		expect(
			buildListingUrl("/", "", {
				query: "matematicas",
				page: 3,
				resourceType: "",
				language: "",
				license: "",
				tag: "",
				educationalCategory: "",
				educationalOption: "",
			}),
		).toBe("/?q=matematicas&page=3");
	});

	test("drops page parameter when navigating to first page", () => {
		expect(
			buildListingUrl("/", "?q=matematicas&page=2", {
				query: "matematicas",
				page: 1,
				resourceType: "",
				language: "",
				license: "",
				tag: "",
				educationalCategory: "",
				educationalOption: "",
			}),
		).toBe("/?q=matematicas");
	});

	test("includes active filters in the listing URL", () => {
		expect(
			buildListingUrl("/", "", {
				query: "scratch",
				page: 2,
				resourceType: "video",
				language: "es",
				license: "cc-by",
				tag: "robotica",
				educationalCategory: "ele",
				educationalOption: "avanzado",
			}),
		).toBe(
			"/?q=scratch&page=2&resourceType=video&language=es&license=cc-by&tag=robotica&educationalCategory=ele&educationalOption=avanzado",
		);
	});

	test("reads listing state from URL params", () => {
		expect(
			readListingState(
				"?q=scratch&page=3&resourceType=video&language=es&license=cc-by&tag=ia",
			),
		).toEqual({
			query: "scratch",
			page: 3,
			resourceType: "video",
			language: "es",
			license: "cc-by",
			tag: "ia",
			educationalCategory: "",
			educationalOption: "",
			knowledgeAreas: [],
			professionalFamilies: [],
		});
	});

	test("las áreas y las familias van como ids separados por comas (#448)", () => {
		const state = readListingState(
			"?educationalCategory=formacion-profesional&knowledgeAreas=ingles,quimica&professionalFamilies=sanidad",
		);
		expect(state.knowledgeAreas).toEqual(["ingles", "quimica"]);
		expect(state.professionalFamilies).toEqual(["sanidad"]);

		const url = buildListingUrl("/explorar", "?knowledgeAreas=musica", {
			...state,
			query: "",
			page: 1,
		});
		expect(readListingState(url.slice(url.indexOf("?")))).toEqual(state);
		expect(
			buildListingUrl(
				"/explorar",
				"?knowledgeAreas=musica&professionalFamilies=agraria",
				{
					...state,
					knowledgeAreas: [],
					professionalFamilies: [],
				},
			),
		).toBe("/explorar?educationalCategory=formacion-profesional");
	});

	test("uses pushState in push mode", () => {
		const history = {
			pushState: mock(() => {}),
			replaceState: mock(() => {}),
		};

		writeListingStateToHistory(history, "/?q=matematicas&page=2", "push");

		expect(history.pushState).toHaveBeenCalledWith(
			{},
			"",
			"/?q=matematicas&page=2",
		);
		expect(history.replaceState).not.toHaveBeenCalled();
	});

	test("uses replaceState in replace mode", () => {
		const history = {
			pushState: mock(() => {}),
			replaceState: mock(() => {}),
		};

		writeListingStateToHistory(history, "/?q=matematicas&page=2", "replace");

		expect(history.replaceState).toHaveBeenCalledWith(
			{},
			"",
			"/?q=matematicas&page=2",
		);
		expect(history.pushState).not.toHaveBeenCalled();
	});
});
