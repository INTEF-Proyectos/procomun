import { expect, test } from "@playwright/test";
import { PUBLISHED_RESOURCE } from "../../fixtures/test-data";

// #458: el nombre de quien publica lleva a su ficha pública; el del autor, a
// una búsqueda con ese nombre.
test.describe("Nombres de autor pulsables", () => {
	test("el publicador abre su ficha con contador y listado", async ({
		page,
	}) => {
		await page.goto(`/recurso?slug=${PUBLISHED_RESOURCE.slug}`);
		const publisher = page
			.locator(".detail-author-name")
			.getByRole("link", { name: "Humberto Piñero" });
		await publisher.focus();
		await page.keyboard.press("Enter");

		await expect(page).toHaveURL(/\/autor\/user-humberto$/);
		await expect(
			page.getByRole("heading", { level: 1, name: "Humberto Piñero" }),
		).toBeVisible();
		await expect(page.getByText("Recursos publicados")).toBeVisible();
		await expect(
			page.getByRole("link", { name: PUBLISHED_RESOURCE.title }),
		).toBeVisible();
		await expect(page.getByText("humberto.pinero@edu.es")).toHaveCount(0);
	});

	test("el autor lanza una búsqueda con su nombre", async ({ page }) => {
		await page.goto(`/recurso?slug=${PUBLISHED_RESOURCE.slug}`);
		await page
			.locator(".detail-author-role")
			.getByRole("link", { name: "Dra. Elena Martínez O." })
			.click();
		await expect(page).toHaveURL(/\/explorar\?.*q=Dra\.(%20|\+)Elena/);
	});
});
