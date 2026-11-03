import { describe, expect, test } from "bun:test";
import type { ElpxCardPreview } from "./api-client.ts";
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

// Revisión de #471: lo que da la API para un paquete con screenshot.png en la
// raíz y sin index.html. Hay miniatura, pero no visor.
describe("resourceCardMedia con miniatura y sin visor (#471)", () => {
	// Así lo da la API: #470 no encola la captura si no hay index.html.
	const SHOT_ONLY: ElpxCardPreview = {
		hash: "abc",
		previewUrl: null,
		screenshotUrl: "/api/v1/elpx/abc/screenshot.png",
		thumbnailUrl: null,
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

	test("sin visor ni miniatura queda el marcador del tipo", () => {
		const empty: ElpxCardPreview = {
			hash: "abc",
			previewUrl: null,
			screenshotUrl: null,
			thumbnailUrl: null,
		};
		expect(
			resourceCardMedia({ resourceType: "proyecto", elpxPreview: empty }),
		).toEqual({ kind: "empty", icon: "🚀" });
	});
});
