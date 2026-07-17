import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BaseNavIsland } from "./BaseNavIsland.tsx";
import { PublicNavIsland } from "./PublicNavIsland.tsx";

describe("Layout islands", () => {
	test("BaseNavIsland renderiza el shell de navegación pública", () => {
		const html = renderToStaticMarkup(<BaseNavIsland />);

		expect(html).toContain("Crear recurso");
		expect(html).toContain("Iniciar sesion");
	});

	test("PublicNavIsland mantiene visible el acceso a ayuda", () => {
		const html = renderToStaticMarkup(<PublicNavIsland />);

		expect(html).toContain("Ayuda");
		expect(html).toContain("help");
	});
});
