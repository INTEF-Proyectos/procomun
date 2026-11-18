import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReportRecord } from "../../lib/api-client.ts";
import { url } from "../../lib/paths.ts";
import {
	AdminReportsSection,
	ReportTargetCell,
} from "./AdminReportsSection.tsx";

function report(partial: Partial<ReportRecord>): ReportRecord {
	return {
		id: "rep-1",
		resourceId: null,
		reason: "spam",
		status: "pending",
		createdAt: "2026-11-01T00:00:00.000Z",
		updatedAt: "2026-11-01T00:00:00.000Z",
		...partial,
	};
}

describe("AdminReportsSection (#539)", () => {
	test("la cola dice si lo denunciado es una colección y enlaza a su ficha", () => {
		const html = renderToStaticMarkup(
			<ReportTargetCell
				report={report({
					collectionId: "col-1",
					collectionTitle: "Mi colección",
					collectionSlug: "mi-coleccion",
					collectionStatus: "published",
				})}
			/>,
		);
		expect(html).toContain("Colección");
		expect(html).toContain("Mi colección");
		expect(html).toContain(`href="${url("colecciones?slug=mi-coleccion")}"`);
	});

	test("una colección archivada sigue en la cola pero su título no enlaza", () => {
		const html = renderToStaticMarkup(
			<ReportTargetCell
				report={report({
					collectionId: "col-1",
					collectionTitle: "Mi colección",
					collectionSlug: "mi-coleccion",
					collectionStatus: "archived",
				})}
			/>,
		);
		expect(html).toContain("Mi colección");
		expect(html).not.toContain("<a ");
	});

	test("y si es un recurso, enlaza a la ficha del recurso", () => {
		const html = renderToStaticMarkup(
			<ReportTargetCell
				report={report({
					resourceId: "res-1",
					resourceTitle: "Mi recurso",
					resourceSlug: "mi-recurso",
				})}
			/>,
		);
		expect(html).toContain("Recurso");
		expect(html).toContain("Mi recurso");
		expect(html).toContain(`href="${url("recurso?slug=mi-recurso")}"`);
	});

	test("la cabecera de la cola sale traducida", () => {
		const html = renderToStaticMarkup(<AdminReportsSection />);
		expect(html).toContain("Denuncias de contenido");
		expect(html).toContain("Contenido");
	});
});
