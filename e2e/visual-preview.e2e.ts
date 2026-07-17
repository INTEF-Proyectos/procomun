import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { loginAs } from "./utils/auth";
import { VISUAL_PREVIEW_PAGES } from "./visual-preview-pages";

const outputDirectory = process.env.VISUAL_PREVIEW_DIR ?? "visual-previews";
const captureEnabled = process.env.CAPTURE_VISUAL_PREVIEWS === "true";

test.describe("Visual previews", () => {
	test.skip(
		!captureEnabled,
		"Visual previews run in a dedicated step after the regular E2E suite.",
	);

	for (const target of VISUAL_PREVIEW_PAGES) {
		test(target.title, async ({ page }) => {
			if ("auth" in target) {
				await loginAs(page, target.auth);
			}

			await page.goto(target.path, { waitUntil: "domcontentloaded" });
			await expect(page.locator(target.readySelector).first()).toBeVisible();
			await page.evaluate(async () => {
				await document.fonts.ready;
			});
			await page.addStyleTag({
				content: `
					*, *::before, *::after {
						animation: none !important;
						caret-color: transparent !important;
						transition: none !important;
					}
				`,
			});

			await mkdir(outputDirectory, { recursive: true });
			await page.screenshot({
				path: join(outputDirectory, `${target.id}.png`),
				animations: "disabled",
				caret: "hide",
				fullPage: true,
			});
		});
	}
});
