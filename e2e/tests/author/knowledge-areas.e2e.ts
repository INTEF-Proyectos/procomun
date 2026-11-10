import { expect, type Page, test } from "@playwright/test";
import { loginAs } from "../../utils/auth";

// #448 (PR 2): áreas de conocimiento y familia profesional en la edición.
async function createDraft(page: Page, title: string): Promise<string> {
	return page.evaluate(async (resourceTitle) => {
		const res = await fetch("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({
				title: resourceTitle,
				description: "Recurso temporal del e2e de áreas de conocimiento",
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

test.describe("Author - Áreas de conocimiento (#448)", () => {
	test.beforeEach(async ({ page }) => {
		await loginAs(page, "author");
	});

	test("hace falta un área para enviar a revisión", async ({ page }) => {
		const id = await createDraft(page, `Áreas e2e ${Date.now()}`);
		await page.goto(`/editar?id=${id}`);

		await page.getByRole("button", { name: "Enviar a revisión" }).click();
		await expect(page.getByRole("alert").first()).toContainText(
			"Selecciona al menos un área de conocimiento",
		);

		// Búsqueda sin tildes y elección con el teclado.
		const search = page.getByRole("combobox", { name: "Buscar un área" });
		await search.fill("quimi");
		await expect(page.getByRole("option", { name: "Química" })).toBeVisible();
		await search.press("ArrowDown");
		await search.press("Enter");
		await expect(
			page.getByRole("button", { name: "Quitar Química" }),
		).toBeVisible();
		await expect(search).toBeFocused();

		await page.getByRole("button", { name: "Guardar cambios" }).click();
		await expect(page.getByRole("status").first()).toContainText(
			"Cambios guardados",
		);
		await page.getByRole("button", { name: "Enviar a revisión" }).click();
		await expect(page.getByText(/Estado actualizado/)).toBeVisible();
	});

	test("la familia profesional aparece con FP y avisa al quitarla", async ({
		page,
	}) => {
		const id = await createDraft(page, `Familias e2e ${Date.now()}`);
		await page.goto(`/editar?id=${id}`);

		await expect(
			page.getByRole("group", { name: "Familia profesional" }),
		).toHaveCount(0);
		await page
			.getByLabel("Etapa, programa o ámbito educativo")
			.selectOption({ label: "Formación Profesional" });
		const family = page.getByRole("combobox", { name: "Buscar una familia" });
		await family.fill("hostel");
		await page.getByRole("option", { name: "Hostelería y Turismo" }).click();
		await expect(
			page.getByRole("button", { name: "Quitar Hostelería y Turismo" }),
		).toBeVisible();

		await page
			.getByRole("button", { name: "Quitar Formación Profesional" })
			.click();
		await expect(
			page.getByText(
				"al guardar se eliminarán estas familias profesionales: Hostelería y Turismo",
			),
		).toBeVisible();
	});
});
