import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { ResourceVersionPanel } from "./ResourceVersionPanel.tsx";

describe("ResourceVersionPanel", () => {
	test("se renderiza durante la edición existente sin depender de un portal", () => {
		const html = renderToStaticMarkup(
			<MemoryRouter initialEntries={["/editar?id=res-22"]}>
				<ResourceVersionPanel />
			</MemoryRouter>,
		);

		expect(html).toContain('id="edit-versions-panel"');
		expect(html).toContain("Historial de versiones");
	});

	test("no se muestra durante la creación inicial", () => {
		const html = renderToStaticMarkup(
			<MemoryRouter initialEntries={["/editar?id=res-22&new=1"]}>
				<ResourceVersionPanel />
			</MemoryRouter>,
		);

		expect(html).not.toContain('id="edit-versions-panel"');
	});
});
