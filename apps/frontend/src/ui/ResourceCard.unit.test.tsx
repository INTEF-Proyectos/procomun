import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ResourceSummary } from "../lib/types/resource-extended.ts";
import { ResourceCard } from "./ResourceCard.tsx";

function resource(
	elpxPreview: ResourceSummary["elpxPreview"],
): ResourceSummary {
	return {
		id: "res-381",
		slug: "casete",
		title: "Casete retrocediendo rápido",
		description: "Audio sin portada",
		resourceType: "actividad-interactiva",
		language: "es",
		license: "cc-by-sa",
		thumbnailUrl: null,
		elpxPreview,
		editorialStatus: "published",
		createdAt: "2026-10-13T00:00:00.000Z",
	};
}

describe("ResourceCard sin imagen de portada", () => {
	test("no renderiza el preview ni un src que no es imagen", () => {
		const html = renderToStaticMarkup(
			<ResourceCard
				href="/recurso?slug=casete"
				resource={resource({
					hash: "abc",
					previewUrl: "/api/v1/elpx/abc/",
					coverImageUrl: null,
				})}
			/>,
		);

		expect(html).not.toContain("<iframe");
		expect(html).not.toContain("/api/v1/elpx/abc/");
		expect(html).not.toContain("theme/screenshot.png");
		expect(html).toContain("Sin imagen");
	});

	test("muestra la portada cuando la selección devolvió una imagen válida", () => {
		const html = renderToStaticMarkup(
			<ResourceCard
				href="/recurso?slug=casete"
				resource={resource({
					hash: "abc",
					previewUrl: "/api/v1/elpx/abc/",
					coverImageUrl: "/api/v1/elpx/abc/content/resources/cover.png",
				})}
			/>,
		);

		expect(html).toContain("/api/v1/elpx/abc/content/resources/cover.png");
		expect(html).not.toContain("<iframe");
	});
});
