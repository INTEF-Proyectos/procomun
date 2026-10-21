import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PUBLISHED_RESOURCE } from "../../fixtures/test-data";

// Paquete .elpx sintético con lo que trae el de #378: un PDF del propio paquete
// en <iframe>. Bajo el origen opaco (ADR-0026) no se pinta, así que el bridge
// compartido de eXeLearning (ADR-0033, que sustituye a la fachada de ADR-0027)
// lo cambia por un hueco y la ficha superpone el PDF desde el padre de confianza.
//
// La fachada de #430 para «Ver online» y para embeds genéricos (Padlet, Canva…)
// vivía en el shim propio que ADR-0033 sustituye por el artefacto vendorizado;
// se resuelve aguas arriba, en eXeLearning, no aquí.
const storageDir =
	process.env.UPLOAD_STORAGE_DIR ??
	path.resolve(import.meta.dirname, "../../../local-data/uploads");
const hash = randomUUID();
const packageDir = path.join(storageDir, "elpx", hash);

test.beforeAll(async () => {
	await mkdir(path.join(packageDir, "content"), { recursive: true });
	await writeFile(
		path.join(packageDir, "index.html"),
		`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Paquete</title></head><body><iframe width="400" height="300" src="content/mapa.pdf"></iframe></body></html>`,
	);
	await writeFile(
		path.join(packageDir, "content", "mapa.pdf"),
		"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
	);
});

test.afterAll(async () => {
	await rm(packageDir, { recursive: true, force: true });
});

test("en la ficha el PDF del paquete se superpone desde el padre", async ({
	page,
}) => {
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

	const pdfUrl = new RegExp(`/api/v1/elpx/${hash}/content/mapa\\.pdf$`);

	// Dentro del origen opaco el iframe del PDF queda como hueco con su URL…
	await expect(
		viewer.contentFrame().locator("[data-exe-embed-url]"),
	).toHaveAttribute("data-exe-embed-url", pdfUrl);

	// …y el padre de confianza pinta el PDF encima, fuera del sandbox.
	await expect(page.locator("iframe[data-exe-embed-player]")).toHaveAttribute(
		"src",
		pdfUrl,
	);
});
