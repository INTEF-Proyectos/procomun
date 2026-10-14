import { expect, type Page, test } from "@playwright/test";
import { PUBLISHED_RESOURCE } from "../../fixtures/test-data";

test.describe("Resource detail page", () => {
	test("displays resource metadata", async ({ page }) => {
		await page.goto(`/recurso?slug=${PUBLISHED_RESOURCE.slug}`);
		await expect(
			page.getByRole("heading", {
				name: new RegExp(PUBLISHED_RESOURCE.title, "i"),
			}),
		).toBeVisible();
	});

	test("shows resource description", async ({ page }) => {
		await page.goto(`/recurso?slug=${PUBLISHED_RESOURCE.slug}`);
		// Resource should have a description visible
		const mainContent = page.getByRole("main").or(page.locator("article"));
		await expect(mainContent).toBeVisible();
	});

	test("shows resource metadata fields", async ({ page }) => {
		await page.goto(`/recurso?slug=${PUBLISHED_RESOURCE.slug}`);
		// Should show metadata like license, type, level, etc. The license is
		// rendered as its slug (e.g. "cc-by-nc-sa"), hence the cc-by matcher.
		await expect(
			page
				.getByText(/licencia|license|cc-by/i)
				.or(page.getByText(/CC BY/i))
				.first(),
		).toBeVisible();
	});

	test("has working back navigation", async ({ page }) => {
		await page.goto("/explorar");
		await page.goto(`/recurso?slug=${PUBLISHED_RESOURCE.slug}`);
		await page.goBack();
		await expect(page).toHaveURL(/\/explorar/);
	});

	test("el menú Descargar se cierra con Escape, con Tab y con clic fuera", async ({
		page,
	}) => {
		await withFiles(page, { elpxFileUrl: null, mediaItems: [PDF] });
		await page.goto(`/recurso?slug=${PUBLISHED_RESOURCE.slug}`);

		const trigger = page.getByRole("button", { name: /^Descargar/ });
		const pdf = page.getByRole("link", { name: "PDF (2.0 KB)" });

		await trigger.press("Enter");
		await expect(trigger).toHaveAttribute("aria-expanded", "true");
		await expect(pdf).toHaveAttribute("download", "");
		await page.keyboard.press("Escape");
		await expect(pdf).toBeHidden();
		await expect(trigger).toBeFocused();

		// Salir con Tab desde el último elemento cierra la lista. Se enfoca el
		// enlace directamente porque Safari no tabula enlaces por defecto.
		await page.keyboard.press("Enter");
		await pdf.focus();
		await page.keyboard.press("Tab");
		await expect(trigger).toHaveAttribute("aria-expanded", "false");

		await trigger.click();
		await expect(pdf).toBeVisible();
		await page.getByRole("heading", { level: 1 }).click();
		await expect(pdf).toBeHidden();
	});

	test("al exportar, la lista se cierra y el foco vuelve a Descargar", async ({
		page,
	}) => {
		// Sustituye al editor eXeLearning: avisa de que el documento está listo
		// y no contesta a la exportación, así el botón se queda en «Preparando».
		await page.route(
			(requestUrl) =>
				requestUrl.pathname.endsWith("/exelearning-editor/index.html"),
			(route) =>
				route.fulfill({
					contentType: "text/html",
					body: '<script>parent.postMessage({ type: "DOCUMENT_LOADED" }, "*");</script>',
				}),
		);
		await withFiles(page, { mediaItems: [PDF, ELPX] });
		await page.goto(`/recurso?slug=${PUBLISHED_RESOURCE.slug}`);

		// El nombre cambia a «Preparando SCORM...» al exportar.
		const trigger = page.getByRole("button", {
			name: /^(Descargar|Preparando)/,
		});
		await trigger.click();
		await expect(
			page.getByRole("link", { name: "ELPX (3.0 KB)" }),
		).toHaveAttribute("href", ELPX.url);
		const scorm = page.getByRole("button", { name: /^SCORM/ });
		await expect(scorm).toBeEnabled();
		await scorm.click();

		await expect(scorm).toBeHidden();
		await expect(trigger).toBeFocused();
		await expect(trigger).toHaveAccessibleName(/^Preparando SCORM/);
	});
});

// #395: el seed no trae ficheros; se añaden a la respuesta real de la API.
const PDF = {
	id: "pdf",
	resourceId: "res-01",
	type: "file",
	url: "/api/v1/uploads/guia/content",
	filename: "guia.pdf",
	fileSize: 2048,
	isPrimary: 1,
};
const ELPX = {
	...PDF,
	id: "elpx",
	url: "/api/v1/uploads/proyecto/content",
	filename: "proyecto.elpx",
	fileSize: 3072,
	isPrimary: 0,
};

async function withFiles(page: Page, overrides: Record<string, unknown>) {
	await page.route(
		(requestUrl) =>
			requestUrl.pathname === `/api/v1/resources/${PUBLISHED_RESOURCE.slug}`,
		async (route) => {
			const response = await route.fetch();
			const resource = await response.json();
			await route.fulfill({ response, json: { ...resource, ...overrides } });
		},
	);
}
