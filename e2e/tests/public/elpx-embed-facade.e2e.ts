import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { PUBLISHED_RESOURCE } from "../../fixtures/test-data";

// Paquete .elpx sintético con lo que traen #378 y #427. Bajo el origen opaco
// (ADR-0026) nada de esto se pinta:
// - el PDF del paquete y el YouTube los trata el artefacto compartido de
//   eXeLearning (ADR-0033): hueco dentro del sandbox y reproductor en el padre;
// - Padlet y Canva, que el artefacto no reconoce, los cambia la fachada genérica
//   (embed-facade.js) por un enlace «Ver contenido de…» (ADR-0033, 2026-10-26).
const storageDir =
	process.env.UPLOAD_STORAGE_DIR ??
	path.resolve(import.meta.dirname, "../../../local-data/uploads");
const hash = randomUUID();
const packageDir = path.join(storageDir, "elpx", hash);
const PADLET = "https://padlet.com/embed/ix8ogfabl3vbz7wt/slideshow";
const YOUTUBE = "https://www.youtube.com/embed/dQw4w9WgXcQ";
// Código adaptable de Canva (#427): contenedor de alto 0 que reserva el hueco
// con padding-top y el <iframe> posicionado encima.
const CANVA = `<div id="canva" style="position:relative;width:100%;height:0;padding-top:141.4%;overflow:hidden"><iframe style="position:absolute;width:100%;height:100%;top:0;left:0;border:none" src="https://www.canva.com/design/DAG/view?embed"></iframe></div>`;

test.beforeAll(async () => {
	await mkdir(path.join(packageDir, "content"), { recursive: true });
	await writeFile(
		path.join(packageDir, "index.html"),
		`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Paquete</title></head><body><iframe width="400" height="300" src="content/mapa.pdf"></iframe><iframe width="560" height="315" src="${YOUTUBE}"></iframe><iframe src="${PADLET}"></iframe>${CANVA}</body></html>`,
	);
	await writeFile(
		path.join(packageDir, "content", "mapa.pdf"),
		"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
	);
});

test.afterAll(async () => {
	await rm(packageDir, { recursive: true, force: true });
});

test.beforeEach(async ({ context }) => {
	// Sin red externa: los proveedores devuelven una página mínima.
	for (const pattern of [
		"https://padlet.com/**",
		"https://*.youtube-nocookie.com/**",
		"https://*.youtube.com/**",
	]) {
		await context.route(pattern, (route) =>
			route.fulfill({ contentType: "text/html", body: "<p>externo</p>" }),
		);
	}
});

async function openResourceWithPackage(page: Page) {
	await page.route(
		`**/api/v1/resources/${PUBLISHED_RESOURCE.slug}`,
		async (route) => {
			const response = await route.fetch();
			const json = await response.json();
			await route.fulfill({
				response,
				json: {
					...json,
					elpxPreview: { hash, previewUrl: `/api/v1/elpx/${hash}/` },
				},
			});
		},
	);
	await page.goto(`/recurso?slug=${PUBLISHED_RESOURCE.slug}`);
	const viewer = page.getByTitle("Vista previa del recurso eXeLearning");
	await viewer.scrollIntoViewIfNeeded();
	return viewer.contentFrame();
}

test("en la ficha el PDF del paquete se superpone desde el padre", async ({
	page,
}) => {
	const frame = await openResourceWithPackage(page);
	const pdfUrl = new RegExp(`/api/v1/elpx/${hash}/content/mapa\\.pdf$`);

	// Dentro del origen opaco el iframe del PDF queda como hueco con su URL…
	await expect(
		frame.locator(`[data-exe-embed-url$="content/mapa.pdf"]`),
	).toHaveAttribute("data-exe-embed-url", pdfUrl);

	// …y el padre de confianza pinta el PDF encima, fuera del sandbox.
	await expect(
		page.locator("iframe[data-exe-embed-player][src$='mapa.pdf']"),
	).toHaveAttribute("src", pdfUrl);
});

test("en la ficha el YouTube lo trata el artefacto, no la fachada", async ({
	page,
}) => {
	const frame = await openResourceWithPackage(page);

	await expect(
		frame.locator('[data-exe-embed-provider="youtube"]'),
	).toHaveCount(1);
	await expect(
		frame.locator('a.procomun-embed-facade[data-procomun-embed-url*="youtube"]'),
	).toHaveCount(0);
});

test("en la ficha Padlet y Canva quedan como «Ver contenido de…»", async ({
	page,
}) => {
	const frame = await openResourceWithPackage(page);

	await expect(
		frame.getByRole("link", { name: "Ver contenido de padlet.com" }),
	).toHaveAttribute("href", PADLET);
	await expect(
		frame.getByRole("link", { name: "Ver contenido de canva.com" }),
	).toBeVisible();
});

test("en «Ver online» el Padlet se abre en una pestaña nueva", async ({
	page,
}) => {
	await page.goto(`/api/v1/elpx/${hash}/`);

	// La pestaña nueva sale del sandbox: Padlet tiene su origen, no "null".
	const popup = page.waitForEvent("popup");
	await page.getByRole("link", { name: "Ver contenido de padlet.com" }).click();
	const tab = await popup;
	await expect(tab).toHaveURL(PADLET);
	expect(await tab.evaluate(() => window.origin)).toBe("https://padlet.com");
});

test("la fachada de un embed adaptable de Canva ocupa su contenedor", async ({
	page,
}) => {
	await page.goto(`/api/v1/elpx/${hash}/`);
	await page.locator("#canva").scrollIntoViewIfNeeded();

	// Con overflow:hidden y alto 0, un enlace en el flujo cae fuera del hueco.
	const hit = await page.evaluate(() => {
		const box = document.getElementById("canva")?.getBoundingClientRect();
		if (!box) return null;
		return document
			.elementFromPoint(box.left + box.width / 2, box.top + 20)
			?.closest("a")?.textContent;
	});
	expect(hit).toBe("Ver contenido de canva.com");
});

test("en «Ver online» la fachada no toca el YouTube ni el PDF", async ({
	page,
}) => {
	await page.goto(`/api/v1/elpx/${hash}/`);

	await expect(page.locator("a.procomun-embed-facade")).toHaveCount(2);
	await expect(
		page.locator(`iframe[src="${YOUTUBE}"], [data-exe-embed-url="${YOUTUBE}"]`),
	).toHaveCount(1);
});
