import { describe, expect, test } from "bun:test";
import {
	buildResourceCard,
	elpxPreviewForViewer,
	roundRatingAverage,
} from "./resource-card.ts";

describe("resource-card", () => {
	test("buildResourceCard normalizes missing social signals", () => {
		const card = buildResourceCard({ id: "res-1", title: "Demo" }, {});

		expect(card.elpxPreview).toBeNull();
		expect(card.favoriteCount).toBe(0);
		expect(card.rating).toEqual({ average: 0, count: 0 });
	});

	test("roundRatingAverage rounds to two decimals", () => {
		expect(roundRatingAverage(4.126)).toBe(4.13);
		expect(roundRatingAverage(undefined)).toBe(0);
	});
});

// Revisión de #481: en el panel, favoritos y valoraciones, lo no publicado
// solo lleva imagen, y firmada, si quien pide puede ver el recurso.
describe("elpxPreviewForViewer", () => {
	const FILE = `${"e".repeat(64)}.jpg`;
	const elpx = {
		resourceId: "r",
		hash: "abc123",
		hasPreview: true,
		thumbnailFile: FILE,
	};
	const author = { id: "autora", role: "author" };
	const stranger = { id: "ajena", role: "author" };

	test("publicado: URL estable para cualquiera", () => {
		const preview = elpxPreviewForViewer(
			elpx,
			{ editorialStatus: "published", createdBy: "autora" },
			null,
		);
		expect(preview?.thumbnailUrl).toBe(`/api/v1/thumbnails/${FILE}`);
		expect(preview?.previewUrl).toBe("/api/v1/elpx/abc123/");
	});

	test("borrador: firmado para su autora y nada para otra persona", () => {
		const draft = { editorialStatus: "draft", createdBy: "autora" };
		const own = elpxPreviewForViewer(elpx, draft, author);
		expect(own?.thumbnailUrl).toStartWith("/api/v1/thumbnails/signed/");
		expect(own?.previewUrl).toStartWith("/api/v1/elpx/preview/abc123/");
		expect(elpxPreviewForViewer(elpx, draft, stranger)).toBeNull();
		expect(elpxPreviewForViewer(elpx, draft, null)).toBeNull();
	});

	test("sin estado conocido nunca da la URL estable", () => {
		const preview = elpxPreviewForViewer(
			elpx,
			{ createdBy: "autora" },
			{ id: "admin", role: "admin" },
		);
		expect(preview?.thumbnailUrl).toStartWith("/api/v1/thumbnails/signed/");
	});
});
