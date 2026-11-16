import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Resource } from "../../lib/api-client.ts";
import { RESOURCE_TYPE_OPTIONS } from "../../lib/resource-filters.ts";
import { DEFAULT_BADGE_CONFIG } from "../../lib/shared-utils.ts";
import {
	MyResourcesTab,
	MyResourcesView,
	type MyResourcesViewProps,
} from "./MyResourcesTab.tsx";
import {
	EMPTY_MY_RESOURCES_FILTERS,
	EMPTY_STATUS_COUNTS,
	MY_RESOURCES_PAGE_SIZE,
} from "./my-resources.ts";

function resource(overrides: Partial<Resource>): Resource {
	return {
		id: "r1",
		slug: "r1",
		title: "Recurso",
		description: "desc",
		language: "es",
		license: "cc-by",
		resourceType: "documento",
		editorialStatus: "draft",
		createdBy: "u1",
		createdAt: "2026-01-01T00:00:00.000Z",
		...overrides,
	} as Resource;
}

function render(props: Partial<MyResourcesViewProps> = {}) {
	const noop = () => {};
	return renderToStaticMarkup(
		<MyResourcesView
			user={{ id: "u1", role: "author" }}
			filters={EMPTY_MY_RESOURCES_FILTERS}
			searchText=""
			resources={[]}
			total={0}
			page={1}
			statusCounts={EMPTY_STATUS_COUNTS}
			loading={false}
			error=""
			notice=""
			badgeConfig={DEFAULT_BADGE_CONFIG}
			areaCatalog={null}
			resourceTypeOptions={RESOURCE_TYPE_OPTIONS}
			onSearchTextChange={noop}
			onFiltersChange={noop}
			onPageChange={noop}
			onDelete={noop}
			{...props}
		/>,
	);
}

const counts = { draft: 1, review: 1, published: 1, archived: 1, total: 4 };

describe("MyResourcesView (#530)", () => {
	test("sin recursos propios invita a crear el primero", () => {
		const html = render();
		expect(html).toContain("Aún no tienes recursos");
		expect(html).not.toContain("my-resources-status");
	});

	test("enseña el buscador y el filtro de estado con los contadores", () => {
		const html = render({
			statusCounts: counts,
			total: 4,
			resources: [resource({})],
		});
		expect(html).toContain("<search");
		expect(html).toContain("Buscar en mis recursos");
		expect(html).toContain("<legend");
		expect(html).toContain("Todos (4)");
		expect(html).toContain("En revisión (1)");
		expect(html).toContain("Archivados (1)");
		expect(html).toContain('type="radio"');
		// Tipo, etapa y área: los filtros del buscador.
		expect(html).toContain("Tipo de Recurso");
		expect(html).toContain("Etapa, programa o ámbito educativo");
	});

	test("cada tarjeta propia tiene editar y eliminar, sin confirm() del navegador", () => {
		const html = render({
			statusCounts: counts,
			total: 2,
			resources: [
				resource({ id: "a", title: "Fracciones", editorialStatus: "review" }),
				resource({ id: "b", title: "Poesía", editorialStatus: "archived" }),
			],
		});
		expect(html).toContain('href="/editar?id=a"');
		expect(html).toContain('aria-label="Editar Fracciones"');
		expect(html).toContain('aria-label="Eliminar Fracciones"');
		expect(html).toContain('aria-haspopup="dialog"');
		expect(html).toContain("En revisión");
		expect(html).toContain("Archivado");
	});

	test("no ofrece editar ni eliminar si el rol no puede gestionar el recurso", () => {
		const html = render({
			user: { id: "u1", role: "reader" },
			statusCounts: counts,
			total: 1,
			resources: [resource({ title: "Importado" })],
		});
		expect(html).toContain("Importado");
		expect(html).not.toContain('aria-label="Eliminar Importado"');
	});

	test("pagina más allá de los primeros recursos", () => {
		const html = render({
			statusCounts: { ...counts, draft: 30, total: 33 },
			total: 33,
			page: 2,
			resources: [resource({})],
		});
		expect(html).toContain(
			`${MY_RESOURCES_PAGE_SIZE + 1}–${MY_RESOURCES_PAGE_SIZE * 2} de 33 recursos`,
		);
		expect(html).toContain('aria-label="Paginación"');
		expect(html).toContain('aria-current="page"');
	});

	test("si los filtros no dan nada lo dice y ofrece limpiarlos", () => {
		const html = render({
			filters: { ...EMPTY_MY_RESOURCES_FILTERS, query: "nada" },
			statusCounts: EMPTY_STATUS_COUNTS,
		});
		expect(html).toContain("Ningún recurso coincide con la búsqueda");
		expect(html).toContain("Limpiar filtros");
	});

	test("el aviso del borrado se anuncia en una región de estado", () => {
		const html = render({
			statusCounts: counts,
			total: 3,
			resources: [resource({})],
			notice: "Se ha eliminado «X».",
		});
		expect(html).toMatch(/role="status"[^>]*>.*Se ha eliminado «X»\./);
	});
});

describe("MyResourcesTab (#530)", () => {
	test("pinta la cabecera y el estado de carga inicial", () => {
		const html = renderToStaticMarkup(
			<MyResourcesTab
				user={{ id: "u1", role: "author" }}
				badgeConfig={DEFAULT_BADGE_CONFIG}
			/>,
		);
		expect(html).toContain("Nuevo recurso");
		expect(html).toContain("Buscando...");
	});
});
