import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import {
	ResourceVersionPanel,
	ResourceVersionPreviewDialog,
} from "./ResourceVersionPanel.tsx";

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

	test("renderiza el ELPX de una versión histórica en una modal aislada", () => {
		const html = renderToStaticMarkup(
			<ResourceVersionPreviewDialog
				version={{
					id: "v1",
					versionNumber: 1,
					fileSha256: "a".repeat(64),
					elpxProjectId: "p1",
					createdBy: null,
					createdByName: null,
					createdAt: null,
					originalFilename: "v1.elpx",
					uploadSessionId: null,
					isCurrent: false,
					downloadUrl: null,
					previewUrl: "/api/admin/resources/res-22/versions/v1/preview/",
				}}
				onClose={() => undefined}
			/>,
		);

		expect(html).toContain("Vista previa de la versión 1");
		expect(html).toContain("resource-version-preview-dialog");
		expect(html).toContain(
			'src="/api/admin/resources/res-22/versions/v1/preview/"',
		);
		expect(html).toContain(
			'sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"',
		);
	});
});
