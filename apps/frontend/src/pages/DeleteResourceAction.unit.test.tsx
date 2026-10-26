import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Resource, SessionUser } from "../lib/api-client.ts";
import {
	DeleteResourceAction,
	deleteResourceMessage,
	deleteResourceRedirectPath,
	removeResource,
} from "./DeleteResourceAction.tsx";

function resource(partial: Partial<Resource> = {}): Resource {
	return {
		id: "res-1",
		slug: "fracciones",
		title: "Fracciones en primaria",
		description: "",
		language: "es",
		license: "cc-by",
		resourceType: "documento",
		keywords: null,
		author: "Ana Autora",
		publisher: null,
		createdBy: "author-1",
		createdByName: "Ana Autora",
		editorialStatus: "draft",
		createdAt: "2026-03-01T00:00:00.000Z",
		updatedAt: "2026-04-02T00:00:00.000Z",
		deletedAt: null,
		...partial,
	};
}

function user(id: string, role: string): SessionUser {
	return { id, role, email: `${id}@example.org`, name: id };
}

function render(who: SessionUser | null, item: Resource): string {
	return renderToStaticMarkup(
		<DeleteResourceAction user={who} resource={item} onDeleted={() => {}} />,
	);
}

describe("DeleteResourceAction — botón «Eliminar recurso» en la edición (#393)", () => {
	test("el autor ve el botón rojo en su propio recurso", () => {
		const html = render(user("author-1", "author"), resource());

		expect(html).toContain("Eliminar recurso");
		expect(html).toContain("edit-delete-btn");
		expect(html).toContain('type="button"');
		expect(html).toContain('aria-haspopup="dialog"');
	});

	test("un autor no ve el botón en un recurso ajeno", () => {
		expect(render(user("author-2", "author"), resource())).toBe("");
	});

	test("sin sesión no se muestra", () => {
		expect(render(null, resource())).toBe("");
	});

	test("el admin lo ve en cualquier recurso", () => {
		const html = render(
			user("admin-1", "admin"),
			resource({ editorialStatus: "published" }),
		);
		expect(html).toContain("Eliminar recurso");
	});

	test("el curator lo ve en la cola de revisión y no en un publicado ajeno", () => {
		const curator = user("curator-1", "curator");
		expect(render(curator, resource({ editorialStatus: "review" }))).toContain(
			"Eliminar recurso",
		);
		expect(render(curator, resource({ editorialStatus: "published" }))).toBe(
			"",
		);
	});

	test("la confirmación nombra el recurso", () => {
		const message = deleteResourceMessage("Fracciones en primaria");
		expect(message).toContain("«Fracciones en primaria»");
		expect(message).toContain("no se puede deshacer");
	});

	test("tras borrar, curator y admin vuelven a Administrar y el autor a su perfil", () => {
		expect(deleteResourceRedirectPath("admin")).toBe("admin?section=resources");
		expect(deleteResourceRedirectPath("curator")).toBe(
			"admin?section=resources",
		);
		expect(deleteResourceRedirectPath("author")).toBe("perfil");
	});

	test("reutiliza el borrado de Administrar y propaga el error", async () => {
		const deleteResource = mock(async (_id: string) => {});
		await removeResource({ deleteResource }, "res-1");
		expect(deleteResource).toHaveBeenCalledWith("res-1");

		const failing = mock(async (_id: string) => {
			throw new Error("HTTP 403");
		});
		await expect(
			removeResource({ deleteResource: failing }, "res-1"),
		).rejects.toThrow("HTTP 403");
	});
});
