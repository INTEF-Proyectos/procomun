import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { MediaItemRecord, Resource } from "../../lib/api-client.ts";
import { ResourceDetailContent } from "./ResourceDetailIsland.tsx";

function file(filename: string, fileSize: number): MediaItemRecord {
	return {
		id: filename,
		resourceId: "res-1",
		type: "file",
		url: `/api/v1/uploads/${filename}/content`,
		filename,
		fileSize,
		isPrimary: 0,
	};
}

function renderDownloadMenu(mediaItems: MediaItemRecord[]): string {
	const resource: Resource = {
		id: "res-1",
		slug: "recurso",
		title: "Recurso",
		description: "",
		language: "es",
		license: "cc-by",
		resourceType: "document",
		keywords: null,
		author: null,
		publisher: null,
		editorialStatus: "published",
		createdBy: null,
		createdByName: null,
		createdAt: null,
		updatedAt: null,
		deletedAt: null,
		mediaItems,
	};
	const html = renderToStaticMarkup(
		<ResourceDetailContent
			resource={resource}
			session={null}
			stats={null}
			isFavorited={false}
			related={null}
		/>,
	);
	const start = html.indexOf('<div class="detail-download"');
	return html.slice(start, html.indexOf("</ul>", start));
}

// #395: «Descargar» es un disclosure, no un menú ARIA.
describe("ResourceDetailIsland — menú Descargar (#395)", () => {
	test("con solo un PDF ofrece el PDF con su tamaño y ninguna exportación", () => {
		const menu = renderDownloadMenu([file("guia.pdf", 2048)]);

		expect(menu).toContain('aria-expanded="false"');
		expect(menu).not.toContain('role="menu');
		expect(menu).toMatch(
			/<ul id="([^"]+)" class="detail-download-menu" hidden="">/,
		);
		expect(menu).toContain(
			'href="/api/v1/uploads/guia.pdf/content" download=""',
		);
		expect(menu).toContain("PDF (2.0 KB)");
		expect(menu).not.toContain("ELPX");
		expect(menu).not.toContain("SCORM");
	});

	test("con ELPX y otros ficheros descarga el ELPX con su tamaño y ofrece las exportaciones", () => {
		const menu = renderDownloadMenu([
			file("guia.pdf", 1024),
			file("proyecto.elpx", 3072),
			file("video.mp4", 4096),
		]);

		expect(menu).toContain(
			'href="/api/v1/uploads/proyecto.elpx/content" download=""',
		);
		expect(menu).toContain("ELPX (3.0 KB)");
		expect(menu).not.toContain("guia.pdf");
		const labels = [...menu.matchAll(/<button[^>]*>([^<]+)/g)].map(
			(match) => match[1],
		);
		expect(labels).toEqual(["SCORM", "IMS", "Web", "EPUB"]);
		expect(menu).not.toContain("LMS");
	});

	test("aria-controls apunta a la lista", () => {
		const menu = renderDownloadMenu([file("guia.pdf", 2048)]);
		const controls = menu.match(/aria-controls="([^"]+)"/)?.[1];
		expect(controls).toBeTruthy();
		expect(menu).toContain(`<ul id="${controls}"`);
	});
});
