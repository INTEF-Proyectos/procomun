import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportButton, sendReport } from "./ReportButton.tsx";

describe("ReportButton (#539)", () => {
	test("el botón dice qué se denuncia: un recurso", () => {
		const html = renderToStaticMarkup(
			<ReportButton target="resource" slug="r" currentUserId="u1" />,
		);
		expect(html).toContain('aria-label="Reportar recurso"');
		expect(html).toContain("Reportar");
	});

	test("el botón dice qué se denuncia: una colección", () => {
		const html = renderToStaticMarkup(
			<ReportButton
				target="collection"
				slug="c"
				currentUserId={null}
				className="collection-report-btn"
			/>,
		);
		expect(html).toContain('aria-label="Reportar colección"');
		expect(html).toContain('class="collection-report-btn"');
	});

	test("sendReport envía la denuncia de una colección a su endpoint", async () => {
		const api = {
			reportResource: mock(async () => ({ id: "r" })),
			reportCollection: mock(async () => ({ id: "c" })),
		};
		await sendReport(api, "collection", "mi-col", "spam", "detalle");
		expect(api.reportCollection).toHaveBeenCalledWith(
			"mi-col",
			"spam",
			"detalle",
		);
		expect(api.reportResource).not.toHaveBeenCalled();
	});

	test("sendReport envía la de un recurso sin descripción vacía", async () => {
		const api = {
			reportResource: mock(async () => ({ id: "r" })),
			reportCollection: mock(async () => ({ id: "c" })),
		};
		await sendReport(api, "resource", "mi-rec", "other", "");
		expect(api.reportResource).toHaveBeenCalledWith(
			"mi-rec",
			"other",
			undefined,
		);
		expect(api.reportCollection).not.toHaveBeenCalled();
	});
});
