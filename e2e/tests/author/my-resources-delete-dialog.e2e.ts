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
		await page.getByLabel("Buscar en mis recursos").fill(title);
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
