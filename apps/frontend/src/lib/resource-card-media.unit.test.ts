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

	test("sin imagen ni paquete no hay medio", () => {
		expect(resourceCardMedia({})).toEqual({ kind: "empty" });
	});
});
