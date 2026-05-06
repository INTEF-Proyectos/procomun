import { expect, test } from "@playwright/test";

test("basic test", async () => {
	// Smoke test so Playwright has at least one E2E file.
	expect(true).toBe(true);
});
