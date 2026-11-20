import { expect, type Page, test } from "@playwright/test";
import { loginAs } from "../../utils/auth";

// #580: el diálogo de borrado de «Mis recursos» retiene el foco con Tab y
// Mayús+Tab, lo devuelve al botón que lo abrió y, tras borrar, lo lleva al aviso.
async function createDraft(page: Page, title: string): Promise<string> {
	return page.evaluate(async (resourceTitle) => {
		const res = await fetch("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({
				title: resourceTitle,
				description: "Recurso temporal del e2e del diálogo de borrado",
				language: "es",
				license: "cc-by",
				resourceType: "documento",
				author: "Yanira Mateos",
			}),
		});
		if (!res.ok) throw new Error(`createResource: ${res.status}`);
		return ((await res.json()) as { id: string }).id;
	}, title);
}

test.describe("Author - Diálogo de borrado en «Mis recursos» (#580)", () => {
	test.beforeEach(async ({ page }) => {
		await loginAs(page, "author");
	});

	test("Tab y Mayús+Tab no salen del diálogo y cancelar devuelve el foco", async ({
		page,
	}) => {
		const title = `Diálogo foco ${Date.now()}`;
		await createDraft(page, title);

		await page.goto("/perfil");
		const filtered = page.waitForResponse((response) => {
			const url = new URL(response.url());
			return (
				url.pathname === "/api/v1/users/me/resources" &&
				url.searchParams.get("q") === title &&
				response.ok()
			);
		});
		await page.getByLabel("Buscar en mis recursos").fill(title);
		await filtered;
		const trigger = page.getByRole("button", { name: `Eliminar ${title}` });
		await expect(trigger).toBeVisible();
		await trigger.click();

		const dialog = page.getByRole("dialog", { name: "Eliminar recurso" });
		const cancel = dialog.getByRole("button", { name: "Cancelar" });
		const confirm = dialog.getByRole("button", { name: "Eliminar" });
		await expect(cancel).toBeFocused();

		await page.keyboard.press("Tab");
		await expect(confirm).toBeFocused();
		await page.keyboard.press("Tab");
		await expect(cancel).toBeFocused();
		await page.keyboard.press("Shift+Tab");
		await expect(confirm).toBeFocused();
		await page.keyboard.press("Shift+Tab");
		await expect(cancel).toBeFocused();

		await cancel.click();
		await expect(dialog).toBeHidden();
		await expect(trigger).toBeFocused();

		await trigger.click();
		await confirm.click();
		const notice = page.getByRole("status").filter({
			hasText: `Se ha eliminado «${title}».`,
		});
		await expect(notice).toBeFocused();
	});
});

// #580: «Limpiar filtros» no debe dejar el foco en `body` al retirarse el botón.
test.describe("Author - «Limpiar filtros» en «Mis recursos» (#580)", () => {
	test("el foco pasa a «Más filtros» y el panel sigue abierto", async ({
		page,
	}) => {
		await loginAs(page, "author");
		const title = `Borrador para limpiar filtros ${Date.now()}`;
		const draftId = await createDraft(page, title);
		try {
			await page.goto("/perfil");
			const resource = page.getByRole("heading", { name: title });
			await expect(resource).toBeVisible();

			const panel = page.locator("details.my-resources-filters");
			const summary = panel.locator("summary");
			await summary.click();
			await page
				.getByLabel("Buscar en mis recursos")
				.fill(`Sin coincidencias ${title}`);
			await expect(
				page.getByRole("heading", {
					name: "Ningún recurso coincide con la búsqueda",
				}),
			).toBeVisible();

			const clear = panel.getByRole("button", { name: "Limpiar filtros" });
			await clear.press("Enter");

			await expect(clear).toHaveCount(0);
			await expect(resource).toBeVisible();
			await expect(panel).toHaveAttribute("open", "");
			await expect(summary).toBeFocused();
		} finally {
			await page.request.delete(`/api/admin/resources/${draftId}`);
		}
	});
});
