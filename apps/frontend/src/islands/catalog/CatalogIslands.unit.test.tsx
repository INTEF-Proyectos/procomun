import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Resource } from "../../lib/api-client.ts";
import { url } from "../../lib/paths.ts";
import { CatalogIsland, CatalogResourceCard } from "./CatalogIsland.tsx";
import { CatalogSearchIsland } from "./CatalogSearchIsland.tsx";
import {
	ResourceDetailContent,
	ResourceDetailIsland,
	updateStatsAfterDownload,
} from "./ResourceDetailIsland.tsx";

function renderDetail(resource: Partial<Resource>, role: string): string {
	return renderToStaticMarkup(
		<ResourceDetailContent
			resource={{
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
				createdBy: "author-1",
				createdByName: "Autora",
				createdAt: null,
				updatedAt: null,
				deletedAt: null,
				...resource,
			}}
			session={{
				user: { id: "curator-1", email: "c@example.org", name: "C", role },
			}}
			stats={null}
			isFavorited={false}
			related={null}
		/>,
	);
}

describe("Catalog islands", () => {
	test("CatalogSearchIsland renderiza el buscador de cabecera", () => {
		const html = renderToStaticMarkup(
			<CatalogSearchIsland initialQuery="matematicas" />,
		);

		expect(html).toContain("Buscar recursos...");
		expect(html).toContain("matematicas");
		expect(html).toContain("Limpiar búsqueda");
	});

	test("CatalogSearchIsland oculta el limpiador si no hay término", () => {
		const html = renderToStaticMarkup(<CatalogSearchIsland initialQuery="" />);

		expect(html).not.toContain("Limpiar búsqueda");
	});

	test("la tarjeta muestra la imagen de metadatos y no el iframe del paquete", () => {
		const html = renderToStaticMarkup(
			<CatalogResourceCard
				resource={{
					id: "r1",
					slug: "inventar-problemas",
					title: "Inventar problemas",
					description: "Una frase inicial",
					language: "es",
					license: "cc-by-nc-sa",
					resourceType: "proyecto",
					keywords: null,
					author: "Autor",
					publisher: null,
					editorialStatus: "published",
					createdBy: null,
					createdByName: null,
					createdAt: null,
					updatedAt: null,
					deletedAt: null,
					thumbnailUrl:
						"https://ode.educacion.es/INTEF/1416349635379/vistaPreviaAgrega.png",
					elpxPreview: { hash: "abc", previewUrl: "/api/v1/elpx/abc/" },
				}}
			/>,
		);

		expect(html).toContain("vistaPreviaAgrega.png");
		expect(html).not.toContain("/api/v1/elpx/abc/");
		expect(html).not.toContain("<iframe");
	});

	test("CatalogIsland renderiza el shell inicial del catalogo", () => {
		const html = renderToStaticMarkup(<CatalogIsland />);

		expect(html).toContain("Filtros");
		expect(html).toContain("Cargando recursos...");
		expect(html).toContain("Limpiar filtros");
		expect(html).toContain("chevron_right");
	});

	test("ResourceDetailIsland renderiza el estado de carga inicial", () => {
		const html = renderToStaticMarkup(<ResourceDetailIsland />);

		expect(html).toContain("Cargando recurso...");
	});

	test("ResourceDetailIsland actualiza el contador del formato exportado", () => {
		const stats = {
			downloadCount: 4,
			exportCounts: { scorm: 1, ims: 0, web: 2, epub: 0 },
			favoriteCount: 0,
			ratingAvg: 0,
			ratingCount: 0,
		};

		expect(updateStatsAfterDownload(stats, 5, "scorm")).toEqual({
			...stats,
			downloadCount: 5,
			exportCounts: { scorm: 2, ims: 0, web: 2, epub: 0 },
		});
	});

	test("ResourceDetailIsland no modifica contadores de exportacion en descarga directa", () => {
		const stats = {
			downloadCount: 4,
			exportCounts: { scorm: 1, ims: 0, web: 2, epub: 0 },
			favoriteCount: 0,
			ratingAvg: 0,
			ratingCount: 0,
		};

		expect(updateStatsAfterDownload(stats, 5, "direct")).toEqual({
			...stats,
			downloadCount: 5,
		});
	});

	// #399: «Editar» solo si la API lo permite (canManageResource); antes cualquier
	// curator lo veía y el editor respondía «Recurso no encontrado» por el 403.
	test("la ficha muestra la imagen de la licencia Creative Commons (#404)", () => {
		const html = renderDetail({ license: "cc-by-sa" }, "reader");

		expect(html).toContain("licenses/cc-by-sa.png");
		expect(html).toContain("https://creativecommons.org/licenses/by-sa/4.0/");
		expect(html).toContain('rel="license noopener noreferrer"');
		expect(html).toContain(
			"Licencia Creative Commons Reconocimiento-CompartirIgual 4.0",
		);
		expect(html).not.toContain(">copyright<");
	});

	test("una licencia sin imagen oficial sigue viéndose como texto (#404)", () => {
		const html = renderDetail({ license: "mit-custom" }, "reader");

		expect(html).toContain("mit-custom");
		expect(html).not.toContain("licenses/");
	});

	test("ResourceDetailIsland muestra Editar al curator solo si puede gestionarlo", () => {
		const editHref = `href="${url("editar?id=res-1")}"`;
		expect(renderDetail({}, "curator")).not.toContain("Editar recurso");
		expect(renderDetail({ editorialStatus: "review" }, "curator")).toContain(
			"Editar recurso",
		);
		expect(
			renderDetail(
				{ editorialStatus: "draft", createdBy: "curator-1" },
				"curator",
			),
		).toContain(editHref);
		expect(
			renderDetail({ assignedCuratorId: "curator-1" }, "curator"),
		).toContain(editHref);
		expect(
			renderDetail({ assignedCuratorId: "curator-2" }, "curator"),
		).not.toContain("Editar recurso");
		expect(renderDetail({}, "admin")).toContain("Editar recurso");
	});
});
