import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminKnowledgeAreasSection } from "./AdminKnowledgeAreasSection.tsx";
import { AdminSidebar } from "./AdminSidebar.tsx";

describe("AdminKnowledgeAreasSection (#448)", () => {
	test("renderiza el panel con filtros etiquetados y alta", () => {
		const html = renderToStaticMarkup(<AdminKnowledgeAreasSection />);
		expect(html).toContain("Áreas de conocimiento");
		expect(html).toContain('for="areas-search"');
		expect(html).toContain('for="areas-block-filter"');
		expect(html).toContain('for="areas-status-filter"');
		expect(html).toContain("Nueva área");
		expect(html).toContain("Familias profesionales");
		expect(html).toContain("admin-table");
	});

	test("el menú lo muestra a curator y no a author", () => {
		const curator = renderToStaticMarkup(
			<AdminSidebar
				activeSection="dashboard"
				onSectionChange={() => {}}
				userRole="curator"
				userName="Curator"
			/>,
		);
		expect(curator).toContain("Áreas de conocimiento");
		const author = renderToStaticMarkup(
			<AdminSidebar
				activeSection="dashboard"
				onSectionChange={() => {}}
				userRole="author"
				userName="Author"
			/>,
		);
		expect(author).not.toContain("Áreas de conocimiento");
	});
});
