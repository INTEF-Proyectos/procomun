import { expect, test } from "@playwright/test";
import { loginAs } from "../../utils/auth";

test("el alta de colecciones avisa si falla el catálogo de áreas y deja reintentar (#626)", async ({
	page,
}) => {
	await loginAs(page, "admin");

	let catalogDown = true;
	await page.route("**/api/v1/knowledge-areas", (route) =>
		catalogDown
			? route.fulfill({
					status: 503,
					contentType: "application/json",
					body: JSON.stringify({ error: "No disponible" }),
				})
			: route.fallback(),
	);
	await page.goto("/admin?section=collections");

	const form = page
		.locator("section.admin-inline-form")
		.filter({ hasText: "Nueva coleccion" });
	const title = `Colección sin catálogo ${Date.now()}`;
	await form.getByLabel("Titulo", { exact: true }).fill(title);
	await form
		.getByLabel("Descripcion", { exact: true })
		.fill("Descripción de prueba");

	const notice = form
		.getByRole("alert")
		.filter({ hasText: "No se han podido cargar las áreas de conocimiento" });
	await expect(notice).toBeVisible();

	catalogDown = false;
	await notice.getByRole("button", { name: "Reintentar" }).click();
	await expect(notice).toHaveCount(0);
	// Lo escrito sigue en el formulario.
	await expect(form.getByLabel("Titulo", { exact: true })).toHaveValue(title);
	await expect(form.getByLabel("Descripcion", { exact: true })).toHaveValue(
		"Descripción de prueba",
	);

	const search = form.getByRole("combobox", { name: "Buscar un área" });
	// El aviso se ha ido con el foco dentro: pasa al buscador de áreas.
	await expect(search).toBeFocused();
	await search.fill("quimi");
	await page.getByRole("option", { name: "Química" }).click();
	await expect(
		form.getByRole("button", { name: "Quitar Química" }),
	).toBeVisible();

	await form.getByRole("button", { name: "Crear coleccion" }).click();
	await expect(form.getByText("Coleccion creada.")).toBeVisible();
});
