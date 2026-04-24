import { describe, expect, test } from "bun:test";
import {
	checkDesignContract,
	extractCssCustomProperties,
	extractFrontMatter,
	parseSimpleDesignFrontMatter,
} from "./check-design-md.ts";

const DESIGN_MD = `---
version: alpha
name: Test
description: Test contract
colors:
  primary: "#003fb1"
  secondary: "#006a61"
  tertiary: "#7c3400"
  error: "#ba1a1a"
  background: "#f8f9ff"
  surface: "#f8f9ff"
  on-surface: "#121c28"
  outline: "#737686"
typography:
  body-md:
    fontFamily: Inter
rounded:
  md: 0.5rem
spacing:
  4: 1rem
components:
  button-primary:
    backgroundColor: "{colors.primary}"
  button-secondary:
    backgroundColor: transparent
  input:
    backgroundColor: "{colors.surface}"
  chip:
    backgroundColor: "{colors.surface}"
  card:
    backgroundColor: "{colors.surface}"
  navigation:
    backgroundColor: "{colors.surface}"
---

# Test
`;

const CSS = `
:root {
  --color-primary: #003fb1;
  --color-secondary: #006a61;
  --color-tertiary: #7c3400;
  --color-error: #ba1a1a;
  --color-background: #f8f9ff;
  --color-surface: #f8f9ff;
  --color-on-surface: #121c28;
  --color-outline: #737686;
  --space-4: 1rem;
  --radius-md: 0.5rem;
}
`;

describe("check-design-md", () => {
	test("extracts and parses the DESIGN.md front matter", () => {
		const frontMatter = extractFrontMatter(DESIGN_MD);
		const design = parseSimpleDesignFrontMatter(frontMatter);

		expect(design.version).toBe("alpha");
		expect(design.name).toBe("Test");
		expect(design.colors.primary).toBe("#003fb1");
		expect(design.components["button-primary"]).toEqual({
			backgroundColor: "{colors.primary}",
		});
	});

	test("extracts CSS custom properties", () => {
		expect(extractCssCustomProperties(CSS)["--color-primary"]).toBe("#003fb1");
		expect(extractCssCustomProperties(CSS)["--radius-md"]).toBe("0.5rem");
	});

	test("accepts a complete contract aligned with CSS tokens", () => {
		const design = parseSimpleDesignFrontMatter(extractFrontMatter(DESIGN_MD));
		const result = checkDesignContract(design, extractCssCustomProperties(CSS));

		expect(result.errors).toEqual([]);
	});

	test("reports missing required component tokens and CSS drift", () => {
		const design = parseSimpleDesignFrontMatter(extractFrontMatter(DESIGN_MD));
		delete design.components.card;
		design.colors.primary = "#111111";

		const result = checkDesignContract(design, extractCssCustomProperties(CSS));

		expect(result.errors).toContain("Missing required component token: components.card");
		expect(result.errors).toContain("colors.primary (#111111) does not match --color-primary (#003fb1).");
	});
});
