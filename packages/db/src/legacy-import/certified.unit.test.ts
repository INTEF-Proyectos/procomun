import { describe, expect, it } from "bun:test";
import { isLegacyCertified } from "./certified.ts";

describe("isLegacyCertified (issue #420)", () => {
	it("cuenta como validado solo certified = 1, numérico o texto", () => {
		expect(isLegacyCertified(1)).toBe(true);
		expect(isLegacyCertified("1")).toBe(true);
		expect(isLegacyCertified(" 1 ")).toBe(true);
		expect(isLegacyCertified(true)).toBe(true);
	});

	it("0, nulo, ausente o cualquier otro valor no cuenta", () => {
		for (const value of [0, "0", null, undefined, "", "x", 2, false, {}]) {
			expect(isLegacyCertified(value)).toBe(false);
		}
	});
});
