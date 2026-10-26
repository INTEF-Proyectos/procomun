import { expect, type Page, test } from "@playwright/test";
import { loginAs } from "../../utils/auth";

// #393: el autor elimina su recurso desde la edición, con confirmación que lo
// nombra, y el borrado es el mismo que el de Administrar.
async function createDraft(page: Page, title: string): Promise<string> {
	return page.evaluate(async (resourceTitle) => {
		const res = await fetch("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({
				title: resourceTitle,
				description: "Recurso temporal del e2e de borrado",
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

test.describe("Author - Eliminar recurso desde la edición (#393)", () => {
	test.beforeEach(async ({ page }) => {
		await loginAs(page, "author");
	});

	test("cancelar no borra y confirmar elimina el recurso", async ({ page }) => {
		const title = `Borrar desde edición ${Date.now()}`;
		const id = await createDraft(page, title);

		await page.goto(`/editar?id=${id}`);
		const trigger = page.getByRole("button", { name: "Eliminar recurso" });
		await expect(trigger).toBeVisible();

		await trigger.click();
		const dialog = page.getByRole("dialog", { name: "Eliminar recurso" });
		await expect(dialog).toContainText(`«${title}»`);
		await expect(
			dialog.getByRole("button", { name: "Cancelar" }),
		).toBeFocused();

		await page.keyboard.press("Escape");
		await expect(dialog).toBeHidden();
		await expect(trigger).toBeFocused();

		await trigger.click();
		await dialog.getByRole("button", { name: "Eliminar recurso" }).click();
		await expect(page).toHaveURL(/\/perfil/);

		const status = await page.evaluate(
			async (resourceId) =>
				(
					await fetch(`/api/admin/resources/${resourceId}`, {
						credentials: "include",
					})
				).status,
			id,
		);
		expect(status).toBe(404);
	});
});
