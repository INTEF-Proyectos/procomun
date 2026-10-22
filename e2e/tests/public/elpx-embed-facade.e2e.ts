import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PUBLISHED_RESOURCE } from "../../fixtures/test-data";

// Paquete .elpx sintético con lo que trae el de #378: un PDF del propio paquete
// y un Padlet, los dos en <iframe>. Bajo el origen opaco (ADR-0026) ninguno se
// pinta, así que el shim los cambia por un enlace (ADR-0027).
const storageDir =
	process.env.UPLOAD_STORAGE_DIR ??
	path.resolve(import.meta.dirname, "../../../local-data/uploads");
const hash = randomUUID();
const packageDir = path.join(storageDir, "elpx", hash);
const PADLET = "https://padlet.com/embed/ix8ogfabl3vbz7wt/slideshow";
// Código adaptable de Canva (#427): contenedor de alto 0 que reserva el hueco
// con padding-top y el <iframe> posicionado encima.
const CANVA = `<div id="canva" style="position:relative;width:100%;height:0;padding-top:141.4%;overflow:hidden"><iframe style="position:absolute;width:100%;height:100%;top:0;left:0;border:none" src="https://www.canva.com/design/DAG/view?embed"></iframe></div>`;

test.beforeAll(async () => {
	await mkdir(path.join(packageDir, "content"), { recursive: true });
	await writeFile(
		path.join(packageDir, "index.html"),
		`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Paquete</title></head><body><iframe width="400" height="300" src="content/mapa.pdf"></iframe><iframe src="${PADLET}"></iframe>${CANVA}</body></html>`,
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
	await context.route("https://padlet.com/**", (route) =>
		route.fulfill({ contentType: "text/html", body: "<p>Padlet</p>" }),
	);
});

test("en «Ver online» el PDF y el Padlet se abren en una pestaña nueva", async ({
	page,
}) => {
	await page.goto(`/api/v1/elpx/${hash}/`);

	const pdf = page.getByRole("link", { name: "Ver PDF: mapa.pdf" });
	await expect(pdf).toHaveAttribute(
		"href",
		new RegExp(`/api/v1/elpx/${hash}/content/mapa\\.pdf$`),
	);
	await expect(pdf).toHaveAttribute("target", "_blank");

	// La pestaña nueva sale del sandbox: Padlet tiene su origen, no "null".
	// (Con el PDF no se ve: Chromium headless lo descarga en vez de pintarlo.)
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

test("en la ficha el PDF del paquete se abre en el modal", async ({ page }) => {
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

	await viewer
		.contentFrame()
		.getByRole("link", { name: "Ver PDF: mapa.pdf" })
		.click();

	const dialog = page.getByRole("dialog", { name: "Documento PDF" });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTitle("Documento PDF")).toHaveAttribute(
		"src",
		new RegExp(`/api/v1/elpx/${hash}/content/mapa\\.pdf$`),
	);
});
