import { describe, expect, test } from "bun:test";
import { resourceCoverSrc } from "./resource-cover.ts";

describe("resourceCoverSrc", () => {
	test("rechaza el html del paquete, el screenshot del tema y un ogg", () => {
		expect(
			resourceCoverSrc({
				coverImageUrl: null,
				thumbnailUrl: "/api/v1/elpx/abc/",
			}),
		).toBeNull();
		expect(
			resourceCoverSrc({
				coverImageUrl: "/api/v1/elpx/abc/theme/screenshot.png",
			}),
		).toBeNull();
		expect(
			resourceCoverSrc({
				coverImageUrl: "/api/v1/elpx/abc/content/resources/b00039.ogg",
			}),
		).toBeNull();
	});

	test("acepta la portada del paquete y una miniatura externa", () => {
		expect(
			resourceCoverSrc({
				coverImageUrl: "/api/v1/elpx/abc/content/resources/cover.png",
			}),
		).toBe("/api/v1/elpx/abc/content/resources/cover.png");
		expect(
			resourceCoverSrc({
				thumbnailUrl: "https://img.example/algebra.png",
			}),
		).toBe("https://img.example/algebra.png");
	});
});
