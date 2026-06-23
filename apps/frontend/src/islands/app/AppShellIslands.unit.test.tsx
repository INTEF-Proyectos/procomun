import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LoginIsland } from "../auth/LoginIsland.tsx";
import {
	buildCatalogSearchResetUrl,
	getCatalogSearchQuery,
} from "../../layouts/PublicLayout.tsx";

describe("App shell islands", () => {
	test("LoginIsland renderiza el shell inicial del formulario", () => {
		const html = renderToStaticMarkup(<LoginIsland />);

		expect(html).toContain("Iniciar sesión");
		expect(html).toContain("Correo electrónico");
		expect(html).toContain("Acceder con cuenta institucional");
	});

	test("detecta la búsqueda activa del catálogo desde la URL", () => {
		expect(getCatalogSearchQuery("/explorar", "?q=docente&page=2")).toBe("docente");
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

		expect(buildCatalogSearchResetUrl("/en/explorar", "?q=docente", "/en/explorar")).toBe("/en/explorar");
	});
});
