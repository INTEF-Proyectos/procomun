import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createPublishedElpxPackage } from "../../fixtures/published-elpx";
import { PUBLISHED_RESOURCE } from "../../fixtures/test-data";

// Paquete .elpx sintético ya extraído: un HTML que anida otro HTML del propio
// paquete, como el reproductor de audio de eXeLearning (#379) o una
// diapositiva (#391). Va dentro del .elpx del recurso publicado del seed
// (ver fixtures/published-elpx.ts, issue #466).
let packageDir = "";
let packageUrl = "";

test.beforeAll(async () => {
	({ dir: packageDir, url: packageUrl } = await createPublishedElpxPackage());
	await writeFile(
		path.join(packageDir, "index.html"),
		'<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Padre</title></head><body><iframe src="hijo.html" title="Hijo"></iframe></body></html>',
	);
	await writeFile(
		path.join(packageDir, "hijo.html"),
		'<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Hijo</title></head><body><p>Contenido del hijo</p></body></html>',
	);
});

test.afterAll(async () => {
	await rm(packageDir, { recursive: true, force: true });
});

test("el visor de la ficha carga el iframe hijo de un paquete .elpx", async ({
	page,
}) => {
	// La ficha muestra el paquete sintético en lugar del del seed.
	await page.route(
		`**/api/v1/resources/${PUBLISHED_RESOURCE.slug}`,
		async (route) => {
			const response = await route.fetch();
			const json = await response.json();
			await route.fulfill({
				response,
				json: {
					...json,
					elpxPreview: { ...json.elpxPreview, previewUrl: packageUrl },
				},
			});
		},
	);

	await page.goto(`/recurso?slug=${PUBLISHED_RESOURCE.slug}`);
	const viewer = page.getByTitle("Vista previa del recurso eXeLearning");
	await viewer.scrollIntoViewIfNeeded();

	// Con `frame-ancestors` o `X-Frame-Options` en la respuesta, Chromium
	// bloquea el hijo: su ancestro, el visor, es origen opaco.
	await expect(
		viewer
			.contentFrame()
			.getByTitle("Hijo")
			.contentFrame()
			.getByText("Contenido del hijo"),
	).toBeVisible();
});
