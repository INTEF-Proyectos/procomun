import { expect, test } from "@playwright/test";
import { PUBLIC_COLLECTION } from "../../fixtures/test-data";

test.describe("Collections", () => {
	test("collections page loads and displays collections", async ({ page }) => {
		await page.goto("/colecciones");
		await expect(page.getByRole("heading").first()).toBeVisible();
		await expect(
			page
				.getByText(PUBLIC_COLLECTION.title)
				.or(page.locator('[data-testid="collection-card"]').first()),
		).toBeVisible();
	});

	test("collection detail shows resources", async ({ page }) => {
		await page.goto(`/colecciones?slug=${PUBLIC_COLLECTION.slug}`);
		await expect(
			page.getByRole("heading", {
				name: new RegExp(PUBLIC_COLLECTION.title, "i"),
			}),
		).toBeVisible();
		// Collection should list its resources
		const resourceItems = page
			.getByRole("listitem")
			.or(
				page
					.locator('[data-testid="collection-resource"]')
					.or(page.locator(".collection-resource-grid a")),
			);
		await expect(resourceItems.first()).toBeVisible();
	});
});
