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
		// #629: al volver de la ficha el panel está cerrado, pero el encabezado
		// dice cuántos filtros hay y se pueden limpiar sin abrirlo.
		await expect(language).toBeHidden();
		await expect(page.getByText("2 filtros activos")).toBeVisible();
		await page.getByRole("button", { name: "Limpiar filtros" }).click();
		await expect(search).toHaveValue("");
		await expect(page).toHaveURL(/\/colecciones$/);
		await expect(page.getByText(/filtros? activos?/)).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Limpiar filtros" }),
		).toHaveCount(0);

		// Lo mismo al abrir un enlace filtrado.
		await page.goto("/colecciones?language=ca");
		await expect(page.getByText("1 filtro activo")).toBeVisible();
		await filters.click();
		await expect(language).toHaveValue("ca");
	} finally {
		await page.request.delete(path);
	}
});

test("avisa si falla el catálogo de áreas y reintenta sin perder filtros ni búsqueda (#629)", async ({
	page,
}) => {
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
	await page.goto("/colecciones?q=itinerario&language=ca");
	await page.getByText("Filtros Avanzados", { exact: true }).click();

	const notice = page
		.getByRole("alert")
		.filter({ hasText: "No se han podido cargar las áreas de conocimiento" });
	await expect(notice).toBeVisible();

	catalogDown = false;
	await notice.getByRole("button", { name: "Reintentar" }).click();
	await expect(notice).toHaveCount(0);
	await expect(
		page.getByRole("searchbox", { name: "Buscar colecciones" }),
	).toHaveValue("itinerario");
	await expect(page.getByLabel("Idioma", { exact: true })).toHaveValue("ca");
	await expect(page).toHaveURL(/language=ca/);

	const areas = page.getByRole("combobox", { name: "Buscar un área" });
	await areas.fill("matem");
	await expect(page.getByRole("option", { name: "Matemáticas" })).toBeVisible();
});

test("un error HTTP del listado muestra el aviso y la página sigue operativa (#629)", async ({
	page,
}) => {
	let listingDown = true;
	await page.route(/\/api\/v1\/collections(\?|$)/, (route) =>
		listingDown
			? route.fulfill({
					status: 503,
					contentType: "application/json",
					body: JSON.stringify({ error: "No disponible" }),
				})
			: route.fallback(),
	);
	await page.goto("/colecciones");
	await expect(
		page.getByText("No se pudieron cargar las colecciones."),
	).toBeVisible();

	listingDown = false;
	await page.getByRole("button", { name: "Buscar", exact: true }).click();
	await expect(
		page.getByRole("heading", { name: /\d+ colecciones publicadas/ }),
	).toBeVisible();
	await expect(
		page.getByText("No se pudieron cargar las colecciones."),
	).toHaveCount(0);
});
