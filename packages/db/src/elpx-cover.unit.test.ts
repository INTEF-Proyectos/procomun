import { describe, expect, test } from "bun:test";
import { selectElpxCoverImage } from "./elpx-cover.ts";

/** Entradas del .elpx de ejemplo de la issue #381 (audio, sin portada). */
const ISSUE_381_ENTRIES = [
	"content/css/base.css",
	"content/img/exe_powered_logo.png",
	"theme/style.js",
	"theme/style.css",
	"theme/screenshot.png",
	"theme/img/licenses.gif",
	"theme/img/icons.png",
	"theme/icons/file.png",
	"theme/icons/interactive.png",
	"libs/favicon.ico",
	"content/resources/e21cf8cf/Contenido/cargaSonidoHTML5.html",
	"content/resources/e21cf8cf/Contenido/b00039.ogg",
	"content/resources/e21cf8cf/Contenido/b00039.mp3",
	"index.html",
	"content.xml",
];

describe("selectElpxCoverImage", () => {
	test("no elige un asset interno ni un fichero que no es imagen de portada", () => {
		expect(selectElpxCoverImage(ISSUE_381_ENTRIES)).toBeNull();
		expect(selectElpxCoverImage(["theme/screenshot.png"])).toBeNull();
		expect(
			selectElpxCoverImage([
				"theme/icons/file.png",
				"content/resources/sonido.ogg",
				"content/resources/pagina.html",
			]),
		).toBeNull();
	});

	test("devuelve solo una imagen de portada explícita", () => {
		expect(
			selectElpxCoverImage([
				"theme/screenshot.png",
				"content/resources/cover.png",
				"content/resources/foto-suelta.jpg",
			]),
		).toBe("content/resources/cover.png");
		expect(selectElpxCoverImage(["content/resources/portada.webp"])).toBe(
			"content/resources/portada.webp",
		);
	});
});
