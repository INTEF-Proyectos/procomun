import { describe, expect, test } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CatalogKeyword, CollectionRecord } from "../../lib/api-client.ts";
import {
	buildCollectionColumns,
	CollectionsCrudIsland,
	changedFields,
	createErrorMessage,
	metadataPayload,
} from "./CollectionsCrudIsland.tsx";

function renderCell(node: ReactNode): string {
	return renderToStaticMarkup(node as ReactElement);
}

const sample: CollectionRecord = {
	id: "col-1",
	slug: "coleccion-de-matematicas",
	title: "Coleccion de Matematicas",
	description:
		"Una descripcion bastante larga que no deberia forzar el ancho de la tabla en escritorio y se trunca con elipsis",
	coverImageUrl:
		"https://cdn.example.com/very/long/path/to/cover/image/matematicas-portada.jpg",
	editorialStatus: "published",
	curatorId: "user-1",
	isOrdered: 0,
	resourceCount: 12,
	curatorName: "Ana Curadora",
	createdAt: new Date("2026-01-01"),
	updatedAt: new Date("2026-06-01"),
};

describe("CollectionsCrudIsland", () => {
	test("renderiza el shell inicial de colecciones", () => {
		const html = renderToStaticMarkup(<CollectionsCrudIsland />);

		expect(html).toContain("Nueva coleccion");
		expect(html).toContain("Cargando colecciones...");
		expect(html).toContain("Titulo o descripcion");
		expect(html).toContain("Crear coleccion");
		expect(html).toContain("No hay colecciones para los filtros actuales.");
		expect(html).toContain("admin-inline-form");
		expect(html).toContain("admin-table");
	});

	test("celdas compactas: tipografía, truncado accesible y acciones con aria-label (#304)", () => {
		const columns = buildCollectionColumns({
			busyLoadEdit: false,
			onEdit: () => undefined,
			onDelete: () => undefined,
		});

		const byId = Object.fromEntries(columns.map((c) => [c.id, c]));
		const titleHtml = renderCell(byId.title?.cell(sample));
		const descHtml = renderCell(byId.description?.cell(sample));
		const coverHtml = renderCell(byId.cover?.cell(sample));
		const actionsHtml = renderCell(byId.actions?.cell(sample));

		expect(titleHtml).toContain("admin-collection-title");
		expect(titleHtml).toContain("admin-collection-meta");
		expect(titleHtml).toContain("Coleccion de Matematicas");
		expect(titleHtml).toContain("Ana Curadora");

		expect(descHtml).toContain("admin-collection-ellipsis");
		expect(descHtml).toContain('title="');
		expect(descHtml).toContain(sample.description);

		expect(coverHtml).toContain("admin-collection-cover");
		expect(coverHtml).toContain("Con portada");
		// URL completa solo en title (accesible), no como texto visible de celda
		expect(coverHtml).toContain(`title="${sample.coverImageUrl}"`);
		expect(coverHtml).toMatch(/>Con portada</);

		expect(actionsHtml).toContain(
			'aria-label="Editar Coleccion de Matematicas"',
		);
		expect(actionsHtml).toContain(
			'aria-label="Eliminar Coleccion de Matematicas"',
		);
		expect(actionsHtml).toContain("admin-action-btn--edit");
		expect(actionsHtml).toContain("admin-action-btn--delete");
		expect(byId.description?.className).toContain(
			"admin-collection-cell--clamp",
		);
		expect(byId.cover?.className).toContain("admin-collection-cell--clamp");
	});

	test("el alta muestra los controles de catalogación (#614)", () => {
		const html = renderToStaticMarkup(<CollectionsCrudIsland />);

		expect(html).toContain('id="collection-create-language"');
		expect(html).toContain("Detalles técnicos");
	});

	test("metadataPayload envía los metadatos del alta (#614)", () => {
		expect(
			metadataPayload({
				language: "",
				keywords: [],
				areas: [],
				educational: [],
			}),
		).toEqual({
			language: null,
			keywordIds: [],
			knowledgeAreaIds: [],
			educationalAreas: [],
		});
		expect(
			metadataPayload({
				language: "ca",
				keywords: [{ id: "k1", label: "Uno" } as CatalogKeyword],
				areas: ["matematicas"],
				educational: [],
			}),
		).toMatchObject({
			language: "ca",
			keywordIds: ["k1"],
			knowledgeAreaIds: ["matematicas"],
		});
	});

	test("createErrorMessage muestra el motivo que da la API (#614)", () => {
		expect(
			createErrorMessage({
				error: "Alguna palabra clave no pertenece al catálogo",
			}),
		).toBe("Alguna palabra clave no pertenece al catálogo");
		expect(createErrorMessage({})).toBe("Error al crear la coleccion.");
		expect(createErrorMessage(new TypeError("Failed to fetch"))).toBe(
			"Error al crear la coleccion.",
		);
		expect(createErrorMessage(null)).toBe("Error al crear la coleccion.");
	});

	test("al cambiar solo el título, el PATCH no lleva los demás campos (#623)", () => {
		const loaded = {
			title: "Título",
			description: "Descripción",
			language: "es" as string | null,
			keywordIds: ["k1"],
			knowledgeAreaIds: ["a1"],
			educationalAreas: [{ categoryId: "c1", optionId: null }],
		};
		expect(changedFields(loaded, { ...loaded, title: "Otro título" })).toEqual({
			title: "Otro título",
		});
		// Vaciar un campo se envía de forma explícita.
		const cleared: typeof loaded = {
			...loaded,
			language: null,
			keywordIds: [],
		};
		expect(changedFields(loaded, cleared)).toEqual({
			language: null,
			keywordIds: [],
		});
	});
});
