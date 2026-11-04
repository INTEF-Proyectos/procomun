import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type {
	CollectionDetailRecord,
	CollectionResourceRecord,
} from "../../lib/api-client.ts";
import {
	CollectionDetailContent,
	PublicCollectionsIsland,
	readCollectionLocation,
} from "./PublicCollectionsIsland.tsx";

function renderCollectionDetail(
	resource: Partial<CollectionResourceRecord>,
): string {
	const detail: CollectionDetailRecord = {
		id: "col-1",
		slug: "coleccion",
		title: "Colección de prueba",
		description: "Descripción",
		editorialStatus: "published",
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
});
