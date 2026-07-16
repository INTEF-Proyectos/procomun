import { describe, expect, it } from "bun:test";
import { DEMO_RESOURCES } from "./seed-data.ts";
import { RESOURCE_TYPES, RESOURCE_TYPE_VALUES } from "./resource-types.ts";

describe("RESOURCE_TYPES", () => {
	it("has unique, non-empty values and labels", () => {
		expect(RESOURCE_TYPES.length).toBeGreaterThan(0);
		const values = RESOURCE_TYPES.map((t) => t.value);
		expect(new Set(values).size).toBe(values.length);
		for (const t of RESOURCE_TYPES) {
			expect(t.value.trim()).not.toBe("");
			expect(t.label.trim()).not.toBe("");
		}
	});

	it("RESOURCE_TYPE_VALUES mirrors RESOURCE_TYPES", () => {
		expect(RESOURCE_TYPE_VALUES).toEqual(RESOURCE_TYPES.map((t) => t.value));
	});

	// Guardián de deriva: antes de que existiera esta lista única, cada
	// consumidor (filtros del frontend, diccionario del importador, datos
	// semilla) mantenía su propia copia a mano, y podían desincronizarse sin
	// que ningún test lo detectara — ver comentario en resource-types.ts.
	it("covers every resourceType usado en los datos semilla (DEMO_RESOURCES)", () => {
		const seedTypes = new Set(DEMO_RESOURCES.map((r) => r.resourceType));
		for (const type of seedTypes) {
			expect(RESOURCE_TYPE_VALUES).toContain(type);
		}
	});
});
