import { expect, test } from "@playwright/test";
import { PUBLIC_COLLECTION } from "../../fixtures/test-data";
import { loginAs } from "../../utils/auth";

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

test("combina texto y filtros técnicos de colecciones y permite limpiarlos", async ({
	page,
}) => {
	await loginAs(page, "admin");
	const title = `Itinerario de filtrado ${crypto.randomUUID()}`;
	const response = await page.request.post("/api/admin/collections", {
		data: {
			title,
			description: "Ejemplo de filtrado",
			editorialStatus: "published",
		},
	});
	expect(response.ok()).toBe(true);
	const { id } = await response.json();
	const path = `/api/admin/collections/${id}`;
	try {
		const update = await page.request.patch(path, {
			data: {
				language: "ca",
				educationalAreas: [
					{ categoryId: "educacion-primaria", optionId: "primer-ciclo" },
				],
				knowledgeAreaIds: ["matematicas"],
			},
		});
		expect(update.ok()).toBe(true);

		await page.goto("/colecciones");
		const search = page.getByRole("searchbox", { name: "Buscar colecciones" });
		await search.fill(title);
		await search.press("Enter");
		const card = page.getByRole("heading", { name: title, exact: true });
		await expect(card).toBeVisible();

		const filters = page.getByText("Filtros Avanzados", { exact: true });
		await filters.click();
		const language = page.getByLabel("Idioma", { exact: true });
		await language.selectOption("es");
		await expect(
			page.getByText(
				"No hay colecciones publicadas para los filtros actuales.",
			),
		).toBeVisible();
		await language.selectOption("ca");
		await page
			.getByLabel("Etapa, programa o ámbito educativo")
			.selectOption("educacion-primaria");
		await page
			.locator("#filter-educational-option")
			.selectOption("primer-ciclo");
		await expect(card).toBeVisible();
		await expect(page).toHaveURL(/educationalOption=primer-ciclo/);

		await card.click();
		await expect(
			page.getByRole("heading", { level: 1, name: title }),
		).toBeVisible();
		await page.getByRole("link", { name: "Volver al listado" }).click();
		await expect(card).toBeVisible();
		await expect(search).toHaveValue(title);
		await filters.click();
		await expect(language).toHaveValue("ca");
		await page.getByRole("button", { name: "Limpiar filtros" }).click();
		await expect(search).toHaveValue("");
		await expect(language).toHaveValue("");
		await expect(page).toHaveURL(/\/colecciones$/);
	} finally {
		await page.request.delete(path);
	}
});
