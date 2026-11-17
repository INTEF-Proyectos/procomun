import { expect, type Page, test } from "@playwright/test";
import {
	PUBLIC_COLLECTION,
	PUBLISHED_RESOURCE,
} from "../../fixtures/test-data";

// #470 (ADR-0046): ningún listado carga el paquete en un iframe. Las tarjetas
// usan screenshot.png, la imagen legacy, la miniatura generada en el servidor
// o el marcador del tipo de recurso. Desde #458 las tarjetas de Explorar y de
// recomendados son <article> (llevan dentro el enlace al autor), no <a>: los
// selectores no fijan la etiqueta.
const CARD_FRAMES = [
	".resource-card iframe",
	".rc-card iframe",
	".home-featured-grid iframe",
	".home-news-grid iframe",
	".collection-resource-card iframe",
].join(", ");

/** Documentos del .elpx pedidos desde un marco (iframe) de la página. */
function trackElpxFrames(page: Page): string[] {
	const loaded: string[] = [];
	page.on("request", (request) => {
		if (
			request.resourceType() === "document" &&
			request.frame() !== page.mainFrame() &&
			request.url().includes("/api/v1/elpx/")
		) {
			loaded.push(request.url());
		}
	});
	return loaded;
}

const LISTINGS = [
	{ name: "portada", path: "/", ready: ".home-featured-hero, .home-news-card" },
	{ name: "Explorar", path: "/explorar", ready: ".resource-card" },
	{
		name: "colección",
		path: `/colecciones?slug=${PUBLIC_COLLECTION.slug}`,
		ready: ".collection-resource-card",
	},
];

test.describe("Tarjetas sin iframe (#470)", () => {
	for (const listing of LISTINGS) {
		test(`${listing.name}: las tarjetas no cargan el paquete`, async ({
			page,
		}) => {
			const loaded = trackElpxFrames(page);
			await page.goto(listing.path);
			await expect(page.locator(listing.ready).first()).toBeVisible();

			await expect(page.locator(CARD_FRAMES)).toHaveCount(0);
			expect(loaded).toEqual([]);
		});
	}

	// La ficha sí tiene su visor; lo que no puede llevar iframe son las
	// tarjetas de recomendados.
	test("ficha: los recomendados no cargan el paquete", async ({ page }) => {
		await page.goto(`/recurso?slug=${PUBLISHED_RESOURCE.slug}`);
		await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
		await expect(page.locator(".rc-card iframe")).toHaveCount(0);
	});
});
