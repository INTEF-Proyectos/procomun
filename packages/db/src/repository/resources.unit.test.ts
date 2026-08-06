import { describe, expect, test } from "bun:test";
import { pickEditableResourceFields } from "./resources.ts";

describe("pickEditableResourceFields — anti mass assignment", () => {
	test("conserva solo campos descriptivos editables", () => {
		const safe = pickEditableResourceFields({
			title: "Título",
			description: "Desc",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			keywords: "a,b",
			author: "Ana",
			publisher: "INTEF",
		});
		expect(safe).toEqual({
			title: "Título",
			description: "Desc",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			keywords: "a,b",
			author: "Ana",
			publisher: "INTEF",
		});
	});

	test("descarta columnas sensibles (editorial, propiedad, curación, slug…)", () => {
		const safe = pickEditableResourceFields({
			title: "Ok",
			editorialStatus: "published",
			createdBy: "atacante",
			assignedCuratorId: "curador",
			featuredAt: "2030-01-01T00:00:00.000Z",
			slug: "slug-forzado",
			deletedAt: "2030-01-01T00:00:00.000Z",
			curatedAt: "2030-01-01T00:00:00.000Z",
			id: "id-forzado",
		});
		expect(safe).toEqual({ title: "Ok" });
		expect(safe).not.toHaveProperty("editorialStatus");
		expect(safe).not.toHaveProperty("createdBy");
		expect(safe).not.toHaveProperty("assignedCuratorId");
		expect(safe).not.toHaveProperty("featuredAt");
		expect(safe).not.toHaveProperty("slug");
		expect(safe).not.toHaveProperty("deletedAt");
		expect(safe).not.toHaveProperty("id");
	});

	test("ignora valores no string (defensa en profundidad frente a tipos raros)", () => {
		const safe = pickEditableResourceFields({
			title: 123,
			description: { $ne: null },
			language: ["es"],
			license: null,
			resourceType: true,
			keywords: undefined,
			author: "válido",
		});
		expect(safe).toEqual({ author: "válido" });
	});

	test("objeto vacío o solo basura produce objeto vacío", () => {
		expect(pickEditableResourceFields({})).toEqual({});
		expect(
			pickEditableResourceFields({ editorialStatus: "published" }),
		).toEqual({});
	});
});
