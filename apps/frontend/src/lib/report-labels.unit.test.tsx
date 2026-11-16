import { describe, expect, test } from "bun:test";
import {
	REPORT_REASON_VALUES,
	reportActionOptions,
	reportReasonLabel,
	reportStatusLabel,
	reportTarget,
} from "./report-labels.tsx";

describe("etiquetas de denuncias (#539)", () => {
	test("todos los motivos tienen etiqueta y el desconocido se muestra tal cual", () => {
		for (const reason of REPORT_REASON_VALUES) {
			expect(reportReasonLabel(reason)).not.toBe(reason);
		}
		expect(reportReasonLabel("inappropriate")).toBe("Contenido inapropiado");
		expect(reportReasonLabel("raro")).toBe("raro");
	});

	test("el estado desconocido se muestra tal cual", () => {
		expect(reportStatusLabel("in_review")).toBe("En revisión");
		expect(reportStatusLabel("raro")).toBe("raro");
	});

	test("una denuncia con colección es de colección; si no, de recurso", () => {
		expect(reportTarget({ collectionId: "c1", resourceId: null })).toBe(
			"collection",
		);
		expect(reportTarget({ collectionId: null, resourceId: "r1" })).toBe(
			"resource",
		);
	});

	test("las acciones de una colección no incluyen las de recurso, y al revés", () => {
		const forCollection = reportActionOptions("collection").map((o) => o.value);
		const forResource = reportActionOptions("resource").map((o) => o.value);

		expect(forCollection).toContain("collection_deactivated");
		expect(forCollection).toContain("collection_deleted");
		expect(forCollection.some((v) => v.startsWith("resource_"))).toBe(false);

		expect(forResource).toContain("resource_deleted");
		expect(forResource.some((v) => v.startsWith("collection_"))).toBe(false);

		// Las comunes y la opción vacía inicial están en las dos.
		for (const common of ["", "dismissed", "resolved_no_change"]) {
			expect(forCollection).toContain(common);
			expect(forResource).toContain(common);
		}
	});
});
