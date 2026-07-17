import { describe, expect, test } from "bun:test";
import { CONTENT_IFRAME_SANDBOX } from "./embed-sandbox.ts";

describe("CONTENT_IFRAME_SANDBOX", () => {
	const tokens = CONTENT_IFRAME_SANDBOX.split(" ").filter(Boolean);

	test("keeps the capabilities the eXeLearning iDevices need", () => {
		expect(tokens).toContain("allow-scripts");
		expect(tokens).toContain("allow-popups");
		expect(tokens).toContain("allow-forms");
	});

	test("never grants a same-origin escape (audit H-1)", () => {
		// An opaque origin: author content cannot reach the authenticated platform.
		expect(tokens).not.toContain("allow-same-origin");
		// A popup opened from the sandboxed content must stay sandboxed.
		expect(tokens).not.toContain("allow-popups-to-escape-sandbox");
	});

	test("matches the canonical secure token set of the other hosts", () => {
		expect([...tokens].sort()).toEqual([
			"allow-forms",
			"allow-popups",
			"allow-scripts",
		]);
	});
});
