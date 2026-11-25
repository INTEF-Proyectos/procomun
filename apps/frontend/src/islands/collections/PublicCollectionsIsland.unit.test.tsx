import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type {
	CollectionDetailRecord,
	CollectionResourceRecord,
} from "../../lib/api-client.ts";
import { overwriteGetLocale } from "../../paraglide/runtime.js";
import {
	CollectionDetailContent,
	PublicCollectionsIsland,
	readCollectionLocation,
} from "./PublicCollectionsIsland.tsx";

function renderCollectionDetail(
	resource: Partial<CollectionResourceRecord>,
	viewCount = 0,
	extra: Partial<CollectionDetailRecord> = {},
): string {
	const detail: CollectionDetailRecord = {
		id: "col-1",
		slug: "coleccion",
		title: "Colección de prueba",
		description: "Descripción",
		editorialStatus: "published",
		viewCount,
		curatorId: "curator-1",
		curatorName: "Curadora",
		createdAt: "2026-10-01T00:00:00Z",
		updatedAt: "2026-10-02T00:00:00Z",
		resources: [
			{
				resourceId: "res-1",
				position: 0,
				title: "Recurso de la colección",
				slug: "recurso",
				description: "Descripción del recurso",
				resourceType: "documento",
				language: "es",
				license: "cc-by",
				author: "Autora",
				editorialStatus: "published",
				...resource,
			},
		],
		...extra,
	};
	return renderToStaticMarkup(
		<CollectionDetailContent detail={detail} onBack={() => {}} />,
	);
}

/** Contenido del bloque de metadatos de la tarjeta del recurso. */
function resourceMeta(html: string): string {
	return (
		html.match(/<div class="collection-resource-meta">(.*?)<\/div>/)?.[1] ?? ""
	);
}

describe("PublicCollectionsIsland", () => {
	test("renderiza el shell inicial de colecciones públicas", () => {
		const html = renderToStaticMarkup(<PublicCollectionsIsland />);

		expect(html).toContain("Colecciones publicadas");
		expect(html).toContain("Buscar por título o descripción");
		expect(html).toContain("Cargando colecciones...");
	});

	test("lee el estado de colecciones desde la URL", () => {
		expect(
			readCollectionLocation("?q=matematicas&page=3&slug=algebra"),
		).toEqual({
			query: "matematicas",
			page: 3,
			slug: "algebra",
		});
	});

	// El autor se pinta con ResourceByline desde #458 (#487), asi que en lugar
	// del HTML exacto se comprueba lo que importa aqui: que el idioma no
	// aparece cuando no lo hay, y que si lo hay va delante de la licencia.
	test("el detalle muestra un recurso sin idioma sin fallar ni inventarlo (#473)", () => {
		const html = renderCollectionDetail({ language: null });
		const meta = resourceMeta(html);

		expect(html).toContain("Recurso de la colección");
		// Sin idioma no hay hueco vacio ni «ES» por defecto.
		expect(meta).toStartWith("<span>cc-by</span>");
		expect(meta).not.toContain("<span></span>");
		expect(meta).not.toContain("<span>ES</span>");
		// El autor sigue ahi, ahora como enlace de busqueda (#458).
		expect(meta).toContain("Autora");
	});

	test("el detalle muestra el idioma del recurso cuando lo tiene", () => {
		const meta = resourceMeta(renderCollectionDetail({ language: "en" }));

		expect(meta).toStartWith("<span>EN</span><span>cc-by</span>");
		expect(meta).toContain("Autora");
	});

	test("la ficha de la colección tiene el botón para denunciarla (#539)", () => {
		const html = renderCollectionDetail({});

		expect(html).toContain('aria-label="Reportar colección"');
		expect(html).toContain("collection-report-btn");
	});
});

test("muestra el contador como parte de los metadatos de la ficha (#608)", () => {
	expect(renderCollectionDetail({}, 0)).toContain("0 visitas");
	expect(renderCollectionDetail({}, 1)).toContain("1 visita");
	expect(renderCollectionDetail({}, 2)).toContain("2 visitas");
});

test("los rótulos de los detalles técnicos siguen el idioma de la interfaz (#623)", () => {
	overwriteGetLocale(() => "en");
	try {
		const html = renderCollectionDetail({}, 0, {
			language: "es",
			catalogKeywords: [{ id: "k1", label: "Geometría" }],
			knowledgeAreas: [{ id: "a1", label: "Matemáticas" }],
		} as Partial<CollectionDetailRecord>);
		expect(html).toContain("Technical Details");
		expect(html).toContain("<dt>Language</dt>");
		expect(html).toContain("<dt>Keywords</dt>");
		expect(html).toContain("<dt>Knowledge areas</dt>");
		expect(html).not.toContain("Detalles técnicos");
	} finally {
		overwriteGetLocale(() => "es");
	}
});

test("la ficha presenta a quien creó la colección como autoría, no como «Curator» (#638)", () => {
	const html = renderCollectionDetail({});
	expect(html).toContain("Autoría: Curadora");
	expect(html).not.toContain("Curator:");
});
