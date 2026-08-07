import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminTagsSection } from "./AdminTagsSection.tsx";

describe("AdminTagsSection (#310)", () => {
	test("renderiza el shell del panel de etiquetas", () => {
		const html = renderToStaticMarkup(<AdminTagsSection />);
		expect(html).toContain("Etiquetas");
		expect(html).toContain("Buscar etiqueta");
		expect(html).toContain("Cargando");
		expect(html).toContain("admin-table");
	});
});
