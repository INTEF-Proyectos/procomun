import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminTagsSection, deleteTagMessage } from "./AdminTagsSection.tsx";

describe("AdminTagsSection (#310)", () => {
	test("renderiza el shell del panel de etiquetas", () => {
		const html = renderToStaticMarkup(<AdminTagsSection />);
		expect(html).toContain("Etiquetas");
		expect(html).toContain("Buscar etiqueta");
		expect(html).toContain("Cargando");
		expect(html).toContain("admin-table");
	});

	test("la confirmación de borrado cuenta recursos y colecciones (#623)", () => {
		const message = deleteTagMessage({
			id: "t1",
			slug: "geometria",
			label: "Geometría",
			description: null,
			usageCount: 0,
			collectionCount: 2,
			canonicalTagId: null,
		});
		expect(message).toContain("0 recursos y 2 colecciones");
	});
});
