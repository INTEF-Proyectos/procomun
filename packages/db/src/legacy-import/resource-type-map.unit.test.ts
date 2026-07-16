import { describe, expect, it } from "bun:test";
import { mapResourceType } from "./resource-type-map.ts";

describe("mapResourceType", () => {
	it("maps a known Spanish free-text value (es_2025101012_9102834 / es_2024052212_9181312 style)", () => {
		expect(mapResourceType(["Basado en proyectos"])).toEqual({
			resourceType: "proyecto",
			mapped: true,
		});
	});

	it("maps a known LOM English value", () => {
		expect(mapResourceType(["real project"])).toEqual({
			resourceType: "proyecto",
			mapped: true,
		});
	});

	it("is case/accent insensitive and tolerant to trailing whitespace", () => {
		expect(mapResourceType(["BASADO EN PROYECTOS "])).toEqual({
			resourceType: "proyecto",
			mapped: true,
		});
	});

	it("falls back to a slug for unknown values without forcing a category (1676602802114 style)", () => {
		const result = mapResourceType(["Mapa conceptual"]);
		expect(result.mapped).toBe(false);
		expect(result.resourceType).toBe("mapa-conceptual");
	});

	it("tries later candidates when the first has no dictionary match", () => {
		const result = mapResourceType(["conceptual map", "Basado en proyectos"]);
		expect(result).toEqual({ resourceType: "proyecto", mapped: true });
	});

	it("defaults to documento when there are no non-empty candidates", () => {
		expect(mapResourceType(null)).toEqual({
			resourceType: "documento",
			mapped: false,
		});
		expect(mapResourceType([])).toEqual({
			resourceType: "documento",
			mapped: false,
		});
		expect(mapResourceType([""])).toEqual({
			resourceType: "documento",
			mapped: false,
		});
	});
});
