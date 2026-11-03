import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CardTypeMarker } from "./CardTypeMarker.tsx";
import { ResourceCard } from "./ResourceCard.tsx";

// #409: el marcador es decorativo; el nombre del enlace es el título.
describe("CardTypeMarker", () => {
	test("pinta el icono del tipo oculto a los lectores de pantalla", () => {
		const html = renderToStaticMarkup(<CardTypeMarker icon="🚀" />);
		expect(html).toContain('aria-hidden="true"');
		expect(html).toContain("🚀");
	});

	test("sin icono de tipo usa el genérico, también oculto", () => {
		const html = renderToStaticMarkup(<CardTypeMarker icon={null} />);
		expect(html).toContain('aria-hidden="true"');
		expect(html).toContain("description");
	});
});

const BASE = {
	id: "r1",
	slug: "r1",
	title: "Recurso",
	description: "",
	resourceType: "proyecto",
	language: "es",
	license: "cc-by",
	editorialStatus: "published",
	createdAt: "2026-10-26",
};

describe("ResourceCard (#409)", () => {
	test("con screenshot.png pinta la imagen y no carga el iframe", () => {
		const html = renderToStaticMarkup(
			<ResourceCard
				href="/recurso?slug=r1"
				resource={{
					...BASE,
					elpxPreview: {
						hash: "abc",
						previewUrl: "/api/v1/elpx/abc/",
						screenshotUrl: "/api/v1/elpx/abc/screenshot.png",
					},
				}}
			/>,
		);
		expect(html).toContain('src="/api/v1/elpx/abc/screenshot.png"');
		expect(html).not.toContain("<iframe");
	});

	test("sin imagen ni paquete pinta el marcador del tipo, decorativo", () => {
		const html = renderToStaticMarkup(
			<ResourceCard href="/recurso?slug=r1" resource={BASE} />,
		);
		expect(html).toContain("🚀");
		expect(html).toMatch(/aria-hidden="true"[^>]*>🚀/);
	});

	// Revisión de #471: screenshot.png en la raíz y sin index.html.
	test("con screenshot.png y sin visor pinta la imagen, sin iframe ni marcador", () => {
		const html = renderToStaticMarkup(
			<ResourceCard
				href="/recurso?slug=r1"
				resource={{
					...BASE,
					elpxPreview: {
						hash: "abc",
						previewUrl: null,
						screenshotUrl: "/api/v1/elpx/abc/screenshot.png",
						// #470 no encola la captura de un paquete sin index.html.
						thumbnailUrl: null,
					},
				}}
			/>,
		);
		expect(html).toContain('src="/api/v1/elpx/abc/screenshot.png"');
		expect(html).not.toContain("<iframe");
		expect(html).not.toContain("🚀");
	});
});

// #470: miniatura generada en el servidor; los listados ya no cargan iframes.
describe("ResourceCard (#470)", () => {
	const GENERATED = `/api/v1/thumbnails/${"d".repeat(64)}.jpg`;

	test("usa la miniatura generada, decorativa, si no hay otra imagen", () => {
		const html = renderToStaticMarkup(
			<ResourceCard
				href="/recurso?slug=r1"
				resource={{
					...BASE,
					elpxPreview: {
						hash: "abc",
						previewUrl: "/api/v1/elpx/abc/",
						thumbnailUrl: GENERATED,
					},
				}}
			/>,
		);
		expect(html).toContain(`src="${GENERATED}"`);
		expect(html).toContain('alt=""');
		expect(html).not.toContain("<iframe");
	});

	test("un paquete aún sin miniatura muestra el marcador y no el iframe", () => {
		const html = renderToStaticMarkup(
			<ResourceCard
				href="/recurso?slug=r1"
				resource={{
					...BASE,
					elpxPreview: { hash: "abc", previewUrl: "/api/v1/elpx/abc/" },
				}}
			/>,
		);
		expect(html).not.toContain("<iframe");
		expect(html).not.toContain("/api/v1/elpx/abc/");
		expect(html).toMatch(/aria-hidden="true"[^>]*>🚀/);
	});
});
