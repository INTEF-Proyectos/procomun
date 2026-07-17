import { describe, expect, test } from "bun:test";
import {
	getResourceTypeOptions,
	RESOURCE_TYPE_OPTIONS,
} from "./resource-form-options.ts";

describe("getResourceTypeOptions", () => {
	test("returns the canonical options without duplicating a canonical current value", () => {
		const options = getResourceTypeOptions("mapa-conceptual");

		expect(options).toBe(RESOURCE_TYPE_OPTIONS);
		expect(
			options.filter((option) => option.value === "mapa-conceptual"),
		).toHaveLength(1);
	});

	test("prepends an unknown current value so edit forms preserve it", () => {
		const currentValue = "ficha-tecnica-legacy";
		const options = getResourceTypeOptions(currentValue);

		expect(options[0]).toEqual({
			value: currentValue,
			label: `${currentValue} (valor existente)`,
		});
		expect(
			options.filter((option) => option.value === currentValue),
		).toHaveLength(1);
		expect(options.slice(1)).toEqual(RESOURCE_TYPE_OPTIONS);
	});

	test("returns only canonical options when the current value is empty", () => {
		expect(getResourceTypeOptions(null)).toBe(RESOURCE_TYPE_OPTIONS);
		expect(getResourceTypeOptions("   ")).toBe(RESOURCE_TYPE_OPTIONS);
	});
});
