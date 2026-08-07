import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	ADMIN_RESOURCE_STATUS_FILTERS,
	AdminResourcesSection,
} from "./AdminResourcesSection.tsx";

describe("AdminResourcesSection — recursos archivados (#303)", () => {
	test("STATUS_FILTERS incluye el estado archived", () => {
		const values = ADMIN_RESOURCE_STATUS_FILTERS.map((f) => f.value);
		expect(values).toContain("archived");
		expect(
			ADMIN_RESOURCE_STATUS_FILTERS.find((f) => f.value === "archived")?.label,
		).toBe("Archivado");
	});

	test("el shell inicial expone la tarjeta Archivados y el filtro Archivado", () => {
		const html = renderToStaticMarkup(<AdminResourcesSection />);

		expect(html).toContain("Archivados");
		expect(html).toContain("Archivado");
		expect(html).toContain("admin-stat-icon--archived");
		expect(html).toMatch(/status=archived|value.*archived|Archivado/);
	});
});
