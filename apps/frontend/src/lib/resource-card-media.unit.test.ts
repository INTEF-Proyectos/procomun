import { describe, expect, test } from "bun:test";
import { resourceCardMedia } from "./resource-card-media.ts";

const PREVIEW =
	"https://ode.educacion.es/INTEF/1416349635379/vistaPreviaAgrega.png";
const GENERATED = `/api/v1/thumbnails/${"a".repeat(64)}.jpg`;

describe("resourceCardMedia", () => {
	test("la imagen de metadatos sustituye al paquete", () => {
		expect(
			resourceCardMedia({
				thumbnailUrl: PREVIEW,
				elpxPreview: { thumbnailUrl: GENERATED },
			}),
		).toEqual({ kind: "image", url: PREVIEW });
	});

	// #470: el iframe sale de los listados; sin imagen queda el marcador.
	test("sin ninguna imagen no carga el paquete: marcador del tipo", () => {
		expect(
			resourceCardMedia({
				thumbnailUrl: null,
				resourceType: "proyecto",
				elpxPreview: { screenshotUrl: null, thumbnailUrl: null },
			}),
		).toEqual({ kind: "empty", icon: "🚀" });
	});

	test("ignora una miniatura que no es http(s) ni una ruta propia", () => {
		expect(
			resourceCardMedia({
				thumbnailUrl: "javascript:alert(1)",
				elpxPreview: { thumbnailUrl: "//evil.example/x.jpg" },
			}),
		).toEqual({ kind: "empty", icon: null });
		expect(
			resourceCardMedia({
				thumbnailUrl: "javascript:alert(1)",
				elpxPreview: { thumbnailUrl: GENERATED },
			}),
		).toEqual({ kind: "image", url: GENERATED });
	});

	test("sin imagen ni paquete queda el marcador genérico", () => {
		expect(resourceCardMedia({})).toEqual({ kind: "empty", icon: null });
	});

	// #409: orden screenshot.png → imagen de metadatos → generada → marcador.
	test("la miniatura screenshot.png de eXe 4 manda sobre la imagen legacy", () => {
		expect(
			resourceCardMedia({
				thumbnailUrl: PREVIEW,
				elpxPreview: {
					screenshotUrl: "/api/v1/elpx/abc/screenshot.png",
					thumbnailUrl: GENERATED,
				},
			}),
		).toEqual({ kind: "image", url: "/api/v1/elpx/abc/screenshot.png" });
	});

	test("la miniatura generada va detrás de screenshot.png y de la legacy", () => {
		expect(
			resourceCardMedia({ elpxPreview: { thumbnailUrl: GENERATED } }),
		).toEqual({ kind: "image", url: GENERATED });
		expect(
			resourceCardMedia({
				elpxPreview: {
					screenshotUrl: "/api/v1/elpx/abc/screenshot.png",
					thumbnailUrl: GENERATED,
				},
			}),
		).toEqual({ kind: "image", url: "/api/v1/elpx/abc/screenshot.png" });
	});

	test("el paquete sin miniatura nunca da un medio de vista previa", () => {
		const media = resourceCardMedia({
			elpxPreview: { screenshotUrl: null, thumbnailUrl: null },
		});
		expect(media.kind).toBe("empty");
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
