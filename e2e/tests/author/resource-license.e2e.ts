import { expect, test } from "@playwright/test";
import { loginAs } from "../../utils/auth";

for (const license of ["cc-by-nd", "cc-by-nc-nd"]) {
	test(`guardar otro dato conserva la licencia ${license} (#597)`, async ({
		page,
	}) => {
		await loginAs(page, "author");
		const created = await page.request.post("/api/admin/resources", {
			data: {
				title: `Licencia e2e ${license}`,
				description: "Recurso de prueba",
				language: "es",
				license,
				resourceType: "documento",
				author: "Autora de prueba",
			},
		});
		expect(created.ok()).toBe(true);
		const { id } = (await created.json()) as { id: string };

		await page.goto(`/editar?id=${id}`);
		await expect(page.getByLabel("Licencia")).toHaveValue(license);
		await page.getByLabel("Título").fill(`Nuevo título ${license}`);
		const saved = page.waitForResponse(
			(response) =>
				response.url().endsWith(`/api/admin/resources/${id}`) &&
				response.request().method() === "PATCH",
		);
		await page.getByRole("button", { name: "Guardar cambios" }).click();
		expect((await saved).ok()).toBe(true);

		await page.reload();
		await expect(page.getByLabel("Licencia")).toHaveValue(license);
		await expect(page.getByLabel("Título")).toHaveValue(
			`Nuevo título ${license}`,
		);
	});
}
