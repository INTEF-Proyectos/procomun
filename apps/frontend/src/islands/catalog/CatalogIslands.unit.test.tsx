import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CatalogIsland } from "./CatalogIsland.tsx";
import { CatalogSearchIsland } from "./CatalogSearchIsland.tsx";
import { ResourceDetailIsland, updateStatsAfterDownload } from "./ResourceDetailIsland.tsx";

describe("Catalog islands", () => {
	test("CatalogSearchIsland renderiza el buscador de cabecera", () => {
		const html = renderToStaticMarkup(<CatalogSearchIsland initialQuery="matematicas" />);

		expect(html).toContain("Buscar recursos...");
		expect(html).toContain("matematicas");
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
});
