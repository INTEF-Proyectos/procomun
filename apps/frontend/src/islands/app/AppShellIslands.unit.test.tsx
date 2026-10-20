import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
	buildCatalogSearchResetUrl,
	getCatalogSearchQuery,
	PublicLayout,
} from "../../layouts/PublicLayout.tsx";
import { LoginIsland } from "../auth/LoginIsland.tsx";

function renderPublicNav(path: string): string {
	return renderToStaticMarkup(
		<MemoryRouter initialEntries={[path]}>
			<Routes>
				<Route path="*" element={<PublicLayout />} />
			</Routes>
		</MemoryRouter>,
	);
}

describe("App shell islands", () => {
	test("LoginIsland renderiza el shell inicial del formulario", () => {
		const html = renderToStaticMarkup(<LoginIsland />);

		expect(html).toContain("Iniciar sesión");
		expect(html).toContain("Correo electrónico");
		expect(html).toContain("Acceder con cuenta institucional");
	});

	test("el buscador superior de Explorar, Colecciones y Ayuda tiene botón Buscar (#403)", () => {
		for (const path of ["/explorar", "/colecciones", "/ayuda"]) {
			const html = renderPublicNav(path);
			expect(html).toContain('class="public-nav-search-form"');
			expect(html).toContain('method="get"');
			expect(html).toContain('type="submit"');
			expect(html).toContain('class="public-nav-search-submit"');
			expect(html).toContain(">Buscar<");
		}
	});

	test("detecta la búsqueda activa del catálogo desde la URL", () => {
		expect(getCatalogSearchQuery("/explorar", "?q=docente&page=2")).toBe(
			"docente",
		);
		expect(getCatalogSearchQuery("/colecciones", "?q=docente")).toBe("");
		expect(getCatalogSearchQuery("/en/explorar", "?q=stem")).toBe("stem");
	});

	test("limpiar búsqueda elimina q y reinicia paginación, preservando otros filtros", () => {
		expect(
			buildCatalogSearchResetUrl(
				"/explorar",
				"?q=docente&page=3&resourceType=guide&language=es",
				"/explorar",
			),
		).toBe("/explorar?resourceType=guide&language=es");

		expect(
			buildCatalogSearchResetUrl("/en/explorar", "?q=docente", "/en/explorar"),
		).toBe("/en/explorar");
	});
});
