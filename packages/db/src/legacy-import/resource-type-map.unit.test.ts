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

	it("maps 'Mapa conceptual' to its own dedicated type, not a slug fallback (1676602802114 style)", () => {
		// Antes de la revisión del informe de importación real (ADR-0029),
		// "mapa conceptual" no tenía equivalencia y caía al slug de fallback
		// (que, por coincidencia, producía el mismo string). Ahora es un tipo
		// de recurso propio en RESOURCE_TYPES, con equivalencia real en el
		// diccionario -- mapped debe ser true, no un fallback.
		const result = mapResourceType(["Mapa conceptual"]);
		expect(result).toEqual({ resourceType: "mapa-conceptual", mapped: true });
	});

	it("falls back to a slug for unknown values without forcing a category", () => {
		const result = mapResourceType(["Categoria totalmente desconocida"]);
		expect(result.mapped).toBe(false);
		expect(result.resourceType).toBe("categoria-totalmente-desconocida");
	});

	it("tries later candidates when the first has no dictionary match", () => {
		const result = mapResourceType(["valor-lom-sin-equivalencia", "Basado en proyectos"]);
		expect(result).toEqual({ resourceType: "proyecto", mapped: true });
	});

	// Regresión: 10 valores de origen sin equivalencia detectados en una
	// importación real (826 pares, 275 recursos con warning de resourceType),
	// mapeo confirmado con el usuario (ver ADR-0029, actualización 2026-07-16).
	describe("mapeo ampliado tras el informe de importación real", () => {
		const cases: Array<[string[], string]> = [
			[["Lección magistral"], "presentacion"],
			[["Juego didáctico"], "actividad-interactiva"],
			[["Mapa conceptual"], "mapa-conceptual"],
			[["Cuestionario"], "evaluacion"],
			[["Simulación"], "actividad-interactiva"],
			[["Problema abierto"], "ejercicio"],
			[["Aprendizaje basado en problemas"], "proyecto"],
			[["Texto narrativo"], "documento"],
			[["Webquest"], "actividad-interactiva"],
			[["Presentación multimedia"], "presentacion"],
		];
		for (const [input, expected] of cases) {
			it(`maps ${JSON.stringify(input)} -> ${expected}`, () => {
				const result = mapResourceType(input);
				expect(result).toEqual({ resourceType: expected, mapped: true });
			});
		}

		it("prefers the Spanish resourceType over the LOM English fallback when both are present (1418693406141 style)", () => {
			// resourceType: ["Presentación multimedia", "Juego didáctico"] -- el
			// primer candidato con match gana, nunca llega al segundo.
			const result = mapResourceType(["Presentación multimedia", "Juego didáctico"]);
			expect(result).toEqual({ resourceType: "presentacion", mapped: true });
		});

		it("also recognizes the LOM English term when the Spanish value is absent", () => {
			expect(mapResourceType(["conceptual map"])).toEqual({ resourceType: "mapa-conceptual", mapped: true });
			expect(mapResourceType(["narrative text"])).toEqual({ resourceType: "documento", mapped: true });
		});
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
