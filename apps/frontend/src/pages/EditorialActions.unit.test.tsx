import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EditorialActions, editorialActionsFor } from "./EditorialActions.tsx";

function render(status: string, role: string): string {
	return renderToStaticMarkup(
		<EditorialActions status={status} role={role} onTransition={() => {}} />,
	);
}

function labels(status: string, role: string): string[] {
	return editorialActionsFor(status, role).map((action) => action.label);
}

describe("EditorialActions — el editor publica directamente (#506)", () => {
	test("el editor no ve «Enviar a revisión» en un borrador", () => {
		const html = render("draft", "editor");

		expect(html).not.toContain("Enviar a revisión");
		expect(html).toContain("Publicar directamente");
	});

	test("el editor no tiene acciones sobre un recurso en revisión, publicado o archivado", () => {
		expect(render("review", "editor")).toBe("");
		expect(render("published", "editor")).toBe("");
		expect(render("archived", "editor")).toBe("");
	});

	test("los botones llevan type=button para no enviar el formulario", () => {
		expect(render("draft", "editor")).toContain('type="button"');
	});
});

describe("EditorialActions — los demás roles conservan sus acciones (#506)", () => {
	const expected: Record<string, Record<string, string[]>> = {
		reader: { draft: [], review: [], published: [], archived: [] },
		author: {
			draft: ["Enviar a revisión"],
			review: [],
			published: [],
			archived: [],
		},
		editor: {
			draft: ["Publicar directamente"],
			review: [],
			published: [],
			archived: [],
		},
		curator: {
			draft: ["Enviar a revisión", "Publicar directamente"],
			review: ["Devolver a borrador", "Publicar"],
			published: ["Archivar"],
			archived: ["Restaurar a borrador"],
		},
		admin: {
			draft: ["Enviar a revisión", "Publicar directamente"],
			review: ["Devolver a borrador", "Publicar"],
			published: ["Archivar"],
			archived: ["Restaurar a borrador"],
		},
	};

	for (const [role, byStatus] of Object.entries(expected)) {
		for (const [status, actions] of Object.entries(byStatus)) {
			test(`${role} en ${status}: ${actions.join(", ") || "ninguna"}`, () => {
				expect(labels(status, role)).toEqual(actions);
			});
		}
	}

	test("el author ve «Enviar a revisión» y no «Publicar directamente»", () => {
		const html = render("draft", "author");

		expect(html).toContain("Enviar a revisión");
		expect(html).not.toContain("Publicar directamente");
	});

	test("sin rol conocido no hay acciones", () => {
		expect(render("draft", "desconocido")).toBe("");
		expect(render("estado-raro", "admin")).toBe("");
	});
});
