import { describe, expect, test } from "bun:test";
import { CONTENT_ASSET_CSP, CONTENT_HTML_CSP } from "./elpx-content.ts";

describe("elpx-content CSP (audit H-1)", () => {
	test("HTML CSP keeps the content sandboxed without a same-origin escape", () => {
		expect(CONTENT_HTML_CSP).toContain(
			"sandbox allow-scripts allow-popups allow-forms",
		);
		// The escape token would let an author popup run at the platform origin.
		expect(CONTENT_HTML_CSP).not.toContain("allow-popups-to-escape-sandbox");
		expect(CONTENT_HTML_CSP).not.toContain("allow-same-origin");
	});

	test("non-HTML assets are served with an opaque-origin sandbox", () => {
		const directives = CONTENT_ASSET_CSP.split(";").map((d) => d.trim());
		// A top-level-navigated SVG/XML stays opaque -> its inline script cannot reach the platform.
		expect(directives).toContain("sandbox");
		expect(CONTENT_ASSET_CSP).not.toContain("allow-same-origin");
		expect(CONTENT_ASSET_CSP).not.toContain("allow-scripts");
	});
});
