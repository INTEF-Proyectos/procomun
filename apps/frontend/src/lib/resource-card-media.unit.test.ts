import { describe, expect, test } from "bun:test";
import { resourceCardMedia } from "./resource-card-media.ts";

const PREVIEW =
	"https://ode.educacion.es/INTEF/1416349635379/vistaPreviaAgrega.png";

describe("resourceCardMedia", () => {
	test("la imagen de metadatos sustituye al iframe del paquete", () => {
		expect(
			resourceCardMedia({
				thumbnailUrl: PREVIEW,
				elpxPreview: { previewUrl: "/api/v1/elpx/abc/" },
			}),
		).toEqual({ kind: "image", url: PREVIEW });
	});

	test("sin miniatura sigue el iframe del .elpx", () => {
		expect(
			resourceCardMedia({
				thumbnailUrl: null,
				elpxPreview: { previewUrl: "/api/v1/elpx/abc/" },
			}),
		).toEqual({ kind: "preview", url: "/api/v1/elpx/abc/" });
	});

	test("ignora una miniatura que no es http(s) ni una ruta propia", () => {
		expect(
			resourceCardMedia({
				thumbnailUrl: "javascript:alert(1)",
				elpxPreview: { previewUrl: "/api/v1/elpx/abc/" },
			}),
		).toEqual({ kind: "preview", url: "/api/v1/elpx/abc/" });
	});

	test("sin imagen ni paquete queda el marcador genérico", () => {
		expect(resourceCardMedia({})).toEqual({ kind: "empty", icon: null });
	});

	// #409: orden screenshot.png → imagen de metadatos → iframe → marcador.
	test("la miniatura screenshot.png de eXe 4 manda sobre la imagen legacy", () => {
		expect(
			resourceCardMedia({
				thumbnailUrl: PREVIEW,
				elpxPreview: {
					previewUrl: "/api/v1/elpx/abc/",
					screenshotUrl: "/api/v1/elpx/abc/screenshot.png",
				},
			}),
		).toEqual({ kind: "image", url: "/api/v1/elpx/abc/screenshot.png" });
	});

	test("con screenshot.png no carga el iframe", () => {
		expect(
			resourceCardMedia({
				elpxPreview: {
					previewUrl: "/api/v1/elpx/abc/",
					screenshotUrl: "/api/v1/elpx/abc/screenshot.png",
				},
			}).kind,
		).toBe("image");
	});

	test("sin imagen ni paquete el marcador es el del tipo de recurso", () => {
		expect(resourceCardMedia({ resourceType: "proyecto" })).toEqual({
			kind: "empty",
			icon: "🚀",
		});
	});

	test("un tipo sin icono propio cae al marcador genérico", () => {
		expect(resourceCardMedia({ resourceType: "otro" })).toEqual({
			kind: "empty",
			icon: null,
		});
	});
});
