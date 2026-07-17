import { expect, test } from "@playwright/test";
import { loginAs } from "../../utils/auth";

test.describe("Admin - Panel access", () => {
	test.beforeEach(async ({ page }) => {
		await loginAs(page, "admin");
	});

	test("can access admin panel", async ({ page }) => {
		await page.goto("/admin");
		await expect(page.getByRole("heading").first()).toBeVisible();
	});

	test.fixme("can see user management section", async ({ page }) => {
		// TODO: Implement when user management UI exists.
		await page.goto("/admin");
		const usersSection = page
			.getByRole("link", { name: /usuarios|users/i })
			.or(page.getByText(/gestión.*usuarios|user management/i));
		await expect(usersSection).toBeVisible();
	});

	test.fixme("can list users", async ({ page }) => {
		// TODO: Implement when admin user list page exists.
		await page.goto("/admin");
		const usersLink = page.getByRole("link", { name: /usuarios|users/i });
		if (await usersLink.isVisible()) {
			await usersLink.click();
			await expect(page.getByText(/admin@example.com/)).toBeVisible();
		}
	});

	test.fixme("can edit user role", async ({ page }) => {
		// TODO: Implement when role editing UI exists.
		await page.goto("/admin");
	});
});

test.describe("Admin - Taxonomy management", () => {
	test.beforeEach(async ({ page }) => {
		await loginAs(page, "admin");
	});

	test.fixme("can access taxonomy/category management", async ({ page }) => {
		// TODO: Implement when taxonomy management UI is available.
		await page.goto("/admin");
		const taxonomyLink = page.getByRole("link", {
			name: /categorías|taxonomías|categories/i,
		});
		await expect(taxonomyLink).toBeVisible();
	});

	test.fixme("can create a category", async ({ page }) => {
		// TODO: Implement when category creation UI is available.
		await page.goto("/admin");
	});
});
