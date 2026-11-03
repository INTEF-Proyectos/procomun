import { describe, expect, test } from "bun:test";
import { buildElpxMap, buildElpxPreview } from "./preview.ts";
import { verifyElpxPreviewToken } from "./preview-token.ts";

describe("elpx preview helpers", () => {
	test("buildElpxPreview returns null when preview is unavailable", () => {
		expect(buildElpxPreview(null)).toBeNull();
		expect(buildElpxPreview({ hash: "abc", hasPreview: false })).toBeNull();
		expect(buildElpxPreview({ hasPreview: true })).toBeNull();
	});

	test("buildElpxPreview builds the public preview URL", () => {
		expect(buildElpxPreview({ hash: "abc123", hasPreview: true })).toEqual({
			hash: "abc123",
			previewUrl: "/api/v1/elpx/abc123/",
			screenshotUrl: null,
			thumbnailUrl: null,
		});
	});

	// #409: la tarjeta usa la miniatura de eXe 4 antes que el iframe.
	test("buildElpxPreview añade la miniatura screenshot.png si el paquete la trae", () => {
		expect(
			buildElpxPreview({
				hash: "abc123",
				hasPreview: true,
				hasScreenshot: true,
			}),
		).toEqual({
			hash: "abc123",
			previewUrl: "/api/v1/elpx/abc123/",
			screenshotUrl: "/api/v1/elpx/abc123/screenshot.png",
			thumbnailUrl: null,
		});
	});

	test("buildElpxMap indexes rows by resourceId", () => {
		const rows = [
			{ resourceId: "res-1", hash: "hash-1", hasPreview: true },
			{ resourceId: "res-2", hash: "hash-2", hasPreview: false },
		];

		const map = buildElpxMap(rows);
		expect(map.get("res-1")).toEqual(rows[0]);
		expect(map.get("res-2")).toEqual(rows[1]);
	});
});

describe("miniaturas y estado editorial (#471, #483)", () => {
	for (const status of ["draft", "in_review", "archived", null]) {
		test(`firma la vista previa y la miniatura de un recurso ${status}`, () => {
			const preview = buildElpxPreview(
				{ hash: "abc123", hasPreview: true, hasScreenshot: true },
				status,
			);
			expect(preview).not.toBeNull();
			const url = preview?.previewUrl ?? "";
			expect(url).toStartWith("/api/v1/elpx/preview/abc123/");
			const token = url.split("/").at(-2) ?? "";
			expect(verifyElpxPreviewToken("abc123", token)).toBe(true);
			expect(preview?.screenshotUrl).toBe(`${url}screenshot.png`);
		});
	}

	test("conserva la URL publica de una miniatura publicada", () => {
		expect(
			buildElpxPreview(
				{ hash: "abc123", hasPreview: true, hasScreenshot: true },
				"published",
			)?.screenshotUrl,
		).toBe("/api/v1/elpx/abc123/screenshot.png");
	});

	test("un borrador sin captura conserva screenshotUrl null", () => {
		const preview = buildElpxPreview(
			{ hash: "abc123", hasPreview: true, hasScreenshot: false },
			"draft",
		);
		expect(preview?.previewUrl).toStartWith("/api/v1/elpx/preview/abc123/");
		expect(preview?.screenshotUrl).toBeNull();
	});
});

// #470: miniatura generada en el servidor para los paquetes sin imagen.
describe("miniatura generada (#470)", () => {
	const FILE = `${"b".repeat(64)}.jpg`;

	test("añade la URL del almacén de miniaturas", () => {
		expect(
			buildElpxPreview({
				hash: "abc123",
				hasPreview: true,
				thumbnailFile: FILE,
			})?.thumbnailUrl,
		).toBe(`/api/v1/thumbnails/${FILE}`);
	});

	test("no interpola un nombre que no es del almacén", () => {
		for (const thumbnailFile of [
			"../../etc/passwd",
			"x.jpg",
			`${"b".repeat(64)}.svg`,
			"",
			null,
		]) {
			expect(
				buildElpxPreview({ hash: "abc123", hasPreview: true, thumbnailFile })
					?.thumbnailUrl,
			).toBeNull();
		}
	});
});

// Revisión de #471: la miniatura no depende del visor. Un paquete con
// screenshot.png en la raíz y sin index.html tiene miniatura, pero no visor.
describe("miniatura sin visor HTML (#471)", () => {
	test("expone screenshot.png aunque el paquete no tenga index.html", () => {
		expect(
			buildElpxPreview({
				hash: "abc123",
				hasPreview: false,
				hasScreenshot: true,
			}),
		).toEqual({
			hash: "abc123",
			previewUrl: null,
			screenshotUrl: "/api/v1/elpx/abc123/screenshot.png",
			// #470 solo encola la captura si hay index.html: aquí no hay generada.
			thumbnailUrl: null,
		});
	});

	for (const status of ["draft", "in_review", "archived", null]) {
		test(`firma la miniatura sin visor de un recurso ${status}`, () => {
			const preview = buildElpxPreview(
				{ hash: "abc123", hasPreview: false, hasScreenshot: true },
				status,
			);
			expect(preview?.previewUrl).toBeNull();
			const url = preview?.screenshotUrl ?? "";
			expect(url).toMatch(
				/^\/api\/v1\/elpx\/preview\/abc123\/[^/]+\/screenshot\.png$/,
			);
			const token = url.split("/").at(-2) ?? "";
			expect(verifyElpxPreviewToken("abc123", token)).toBe(true);
		});
	}

	test("sin visor ni miniatura no hay nada que mostrar", () => {
		expect(
			buildElpxPreview({
				hash: "abc123",
				hasPreview: false,
				hasScreenshot: false,
				thumbnailFile: null,
			}),
		).toBeNull();
	});

	// #470: la miniatura generada tampoco depende de que haya visor.
	test("una miniatura generada sin visor no ofrece previewUrl", () => {
		const file = `${"c".repeat(64)}.jpg`;
		expect(
			buildElpxPreview({
				hash: "abc123",
				hasPreview: false,
				hasScreenshot: false,
				thumbnailFile: file,
			}),
		).toEqual({
			hash: "abc123",
			previewUrl: null,
			screenshotUrl: null,
			thumbnailUrl: `/api/v1/thumbnails/${file}`,
		});
	});
});
