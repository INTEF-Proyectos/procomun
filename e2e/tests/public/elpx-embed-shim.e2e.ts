import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";

const SHIM_PATH = path.resolve(
	import.meta.dirname,
	"../../../apps/api/static/elpx/embed-shim.js",
);

// El shim de ADR-0027 en un documento de origen opaco, como el HTML del .elpx
// dentro del visor de la ficha. El visor de PDF no pinta ahí con ninguna
// etiqueta, así que también `object` y `embed` pasan a la fachada (#378).
test("el shim promociona a fachada los PDF en object y embed, no el vídeo", async ({
	page,
}) => {
	const shim = await readFile(SHIM_PATH, "utf8");
	await page.route("https://elpx.test/**", (route) => {
		const { pathname } = new URL(route.request().url());
		if (pathname === "/") {
			return route.fulfill({
				contentType: "text/html",
				body: '<iframe title="Paquete" sandbox="allow-scripts" src="/paquete.html"></iframe>',
			});
		}
		if (pathname === "/paquete.html") {
			return route.fulfill({
				contentType: "text/html",
				headers: { "Content-Security-Policy": "sandbox allow-scripts" },
				body: `<object data="guia.pdf" type="application/pdf"></object>
<embed src="anexo.pdf" type="application/pdf">
<embed src="clip.mp4" type="video/mp4">
<script>${shim}</script>`,
			});
		}
		return route.fulfill({ status: 404 });
	});

	await page.goto("https://elpx.test/");
	const pkg = page.getByTitle("Paquete").contentFrame();

	const facades = pkg.getByRole("button", {
		name: "Reproducir contenido externo",
	});
	await expect(facades).toHaveCount(2);
	await expect(facades.first()).toHaveAttribute(
		"data-procomun-embed-url",
		"https://elpx.test/guia.pdf",
	);
	await expect(
		pkg.locator("object, embed[type='application/pdf']"),
	).toHaveCount(0);
	await expect(pkg.locator("embed[type='video/mp4']")).toHaveCount(1);
});
