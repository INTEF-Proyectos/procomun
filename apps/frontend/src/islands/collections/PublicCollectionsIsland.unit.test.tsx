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

	test("el detalle muestra un recurso sin idioma sin fallar ni inventarlo (#473)", () => {
		const html = renderCollectionDetail({ language: null });

		expect(html).toContain("Recurso de la colección");
		// Sin idioma no hay hueco vacío ni «ES» por defecto: solo licencia y autor.
		expect(resourceMeta(html)).toBe("<span>cc-by</span><span>Autora</span>");
	});

	test("el detalle muestra el idioma del recurso cuando lo tiene", () => {
		expect(resourceMeta(renderCollectionDetail({ language: "en" }))).toBe(
			"<span>EN</span><span>cc-by</span><span>Autora</span>",
		);
	});
});
