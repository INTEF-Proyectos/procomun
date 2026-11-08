import { describe, expect, test } from "bun:test";
import type { ElpxCardPreview } from "./api-client.ts";
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

// Revisión de #471: lo que da la API para un paquete con screenshot.png en la
// raíz y sin index.html. Hay miniatura, pero no visor.
describe("resourceCardMedia con miniatura y sin visor (#471)", () => {
	const SHOT_ONLY: ElpxCardPreview = {
		hash: "abc",
		previewUrl: null,
		screenshotUrl: "/api/v1/elpx/abc/screenshot.png",
	};

	test("la tarjeta usa screenshot.png, no el marcador del tipo", () => {
		expect(
			resourceCardMedia({ resourceType: "proyecto", elpxPreview: SHOT_ONLY }),
		).toEqual({ kind: "image", url: "/api/v1/elpx/abc/screenshot.png" });
	});

	test("la imagen de metadatos queda detrás de screenshot.png", () => {
		expect(
			resourceCardMedia({ thumbnailUrl: PREVIEW, elpxPreview: SHOT_ONLY }),
		).toEqual({ kind: "image", url: "/api/v1/elpx/abc/screenshot.png" });
	});

	test("sin visor no hay iframe aunque falte la miniatura", () => {
		const empty: ElpxCardPreview = {
			hash: "abc",
			previewUrl: null,
			screenshotUrl: null,
		};
		expect(
			resourceCardMedia({ resourceType: "proyecto", elpxPreview: empty }),
		).toEqual({ kind: "empty", icon: "🚀" });
	});
});
