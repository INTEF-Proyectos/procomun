import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Resource } from "../../lib/api-client.ts";
import { url } from "../../lib/paths.ts";
import {
	ADMIN_RESOURCE_STATUS_FILTERS,
	AdminResourcesSection,
	buildAdminResourceColumns,
	canEditAdminResource,
} from "./AdminResourcesSection.tsx";

function resource(
	partial: Pick<Resource, "id" | "slug" | "title" | "editorialStatus">,
): Resource {
	return {
		description: "",
		language: "es",
		license: "cc-by",
		resourceType: "document",
		keywords: null,
		author: "Ana Autora",
		publisher: null,
		createdBy: null,
		createdByName: "Ana Autora",
		createdAt: "2026-03-01T00:00:00.000Z",
		updatedAt: "2026-04-02T00:00:00.000Z",
		deletedAt: null,
		...partial,
	};
}

function renderColumn(
	role: string,
	item: Resource,
	key: "title" | "actions",
): string {
	const columns = buildAdminResourceColumns({
		role,
		busyDelete: false,
		onDelete: () => undefined,
	});
	const column = columns.find((entry) => entry.key === key);
	if (!column) throw new Error(`falta la columna ${key}`);
	return renderToStaticMarkup(column.render(item) as ReactElement);
}

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

describe("AdminResourcesSection — el curator abre el listado (#399)", () => {
	const inReview = resource({
		id: "res-review-001",
		slug: "en-revision",
		title: "Pendiente de revision",
		editorialStatus: "review",
	});
	const published = resource({
		id: "res-published-001",
		slug: "recurso-publicado",
		title: "Recurso publicado",
		editorialStatus: "published",
	});

	test("en revisión el título y la acción van al editor y se conserva eliminar", () => {
		const editHref = url(`editar?id=${inReview.id}`);
		const titleHtml = renderColumn("curator", inReview, "title");
		const actionsHtml = renderColumn("curator", inReview, "actions");

		expect(titleHtml).toContain(`href="${editHref}"`);
		expect(titleHtml).toContain(inReview.title);
		expect(actionsHtml).toContain(`href="${editHref}"`);
		expect(actionsHtml).toContain(`aria-label="Editar ${inReview.title}"`);
		expect(actionsHtml).toContain(`aria-label="Eliminar ${inReview.title}"`);
		expect(actionsHtml).toContain("<button");
		expect(actionsHtml).not.toContain("Solo lectura");
	});

	test("si no puede editar, el título y Solo lectura enlazan a la ficha y no hay span mudo", () => {
		for (const status of ["published", "draft", "archived"] as const) {
			const item = resource({
				id: `res-${status}`,
				slug: `slug-${status}`,
				title: `Titulo ${status}`,
				editorialStatus: status,
			});
			const viewHref = url(`recurso?slug=${item.slug}`);
			const titleHtml = renderColumn("curator", item, "title");
			const actionsHtml = renderColumn("curator", item, "actions");

			expect(actionsHtml).not.toMatch(/<span[^>]*>Solo lectura<\/span>/);
			expect(actionsHtml).toContain(`href="${viewHref}"`);
			expect(actionsHtml).toContain(">Solo lectura</a>");
			expect(actionsHtml).toContain(`aria-label="Solo lectura: ${item.title}"`);
			expect(titleHtml).toContain(`href="${viewHref}"`);
			expect(titleHtml).toContain(item.title);
			expect(titleHtml).not.toContain("editar?id=");
			expect(actionsHtml).not.toContain("editar?id=");
			expect(actionsHtml).not.toContain("Eliminar");
			expect(actionsHtml).not.toContain("<button");
		}
	});

	test("el curator no gana edición sobre lo que hoy solo consulta", () => {
		expect(canEditAdminResource("curator", { editorialStatus: "review" })).toBe(
			true,
		);
		for (const status of ["published", "draft", "archived"]) {
			expect(canEditAdminResource("curator", { editorialStatus: status })).toBe(
				false,
			);
		}
		expect(
			canEditAdminResource("admin", { editorialStatus: "published" }),
		).toBe(true);
		expect(canEditAdminResource("editor", { editorialStatus: "review" })).toBe(
			false,
		);
		expect(canEditAdminResource("reader", { editorialStatus: "review" })).toBe(
			false,
		);
	});

	test("un admin conserva editar y eliminar un recurso publicado", () => {
		const editHref = url(`editar?id=${published.id}`);
		const titleHtml = renderColumn("admin", published, "title");
		const actionsHtml = renderColumn("admin", published, "actions");

		expect(titleHtml).toContain(`href="${editHref}"`);
		expect(titleHtml).not.toContain("recurso?slug=");
		expect(actionsHtml).toContain(`href="${editHref}"`);
		expect(actionsHtml).toContain(`aria-label="Editar ${published.title}"`);
		expect(actionsHtml).toContain(`aria-label="Eliminar ${published.title}"`);
		expect(actionsHtml).not.toContain("Solo lectura");
	});
});
