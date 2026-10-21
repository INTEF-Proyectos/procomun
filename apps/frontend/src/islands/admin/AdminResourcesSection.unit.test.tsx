import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Resource, SessionUser } from "../../lib/api-client.ts";
import { url } from "../../lib/paths.ts";
import {
	ADMIN_RESOURCE_STATUS_FILTERS,
	AdminResourcesSection,
	buildAdminResourceColumns,
} from "./AdminResourcesSection.tsx";

function resource(
	partial: Pick<Resource, "id" | "slug" | "title" | "editorialStatus"> &
		Partial<Resource>,
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

function user(id: string, role: string): SessionUser {
	return { id, role, email: `${id}@example.org`, name: id };
}

const curator = user("curator-1", "curator");

function renderColumn(
	who: SessionUser,
	item: Resource,
	key: "title" | "actions",
): string {
	const columns = buildAdminResourceColumns({
		user: who,
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
		const titleHtml = renderColumn(curator, inReview, "title");
		const actionsHtml = renderColumn(curator, inReview, "actions");

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
			const titleHtml = renderColumn(curator, item, "title");
			const actionsHtml = renderColumn(curator, item, "actions");

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

	test("el curator edita lo que ha creado o curado, como canManageResource", () => {
		const own = resource({
			id: "res-own",
			slug: "propio",
			title: "Borrador propio",
			editorialStatus: "draft",
			createdBy: curator.id,
		});
		const curated = resource({
			id: "res-curated",
			slug: "curado",
			title: "Publicado que curó",
			editorialStatus: "published",
			assignedCuratorId: curator.id,
		});
		for (const item of [own, curated]) {
			const editHref = url(`editar?id=${item.id}`);
			expect(renderColumn(curator, item, "title")).toContain(
				`href="${editHref}"`,
			);
			const actionsHtml = renderColumn(curator, item, "actions");
			expect(actionsHtml).toContain(`aria-label="Editar ${item.title}"`);
			expect(actionsHtml).not.toContain("Solo lectura");
		}

		const otherCurator = resource({
			id: "res-other",
			slug: "de-otro",
			title: "Curado por otro",
			editorialStatus: "published",
			createdBy: "author-1",
			assignedCuratorId: "curator-2",
		});
		expect(renderColumn(curator, otherCurator, "actions")).toContain(
			">Solo lectura</a>",
		);
	});

	test("un admin conserva editar y eliminar un recurso publicado", () => {
		const editHref = url(`editar?id=${published.id}`);
		const titleHtml = renderColumn(
			user("admin-1", "admin"),
			published,
			"title",
		);
		const actionsHtml = renderColumn(
			user("admin-1", "admin"),
			published,
			"actions",
		);

		expect(titleHtml).toContain(`href="${editHref}"`);
		expect(titleHtml).not.toContain("recurso?slug=");
		expect(actionsHtml).toContain(`href="${editHref}"`);
		expect(actionsHtml).toContain(`aria-label="Editar ${published.title}"`);
		expect(actionsHtml).toContain(`aria-label="Eliminar ${published.title}"`);
		expect(actionsHtml).not.toContain("Solo lectura");
	});
});
