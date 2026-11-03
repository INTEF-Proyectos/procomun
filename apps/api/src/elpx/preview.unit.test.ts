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
