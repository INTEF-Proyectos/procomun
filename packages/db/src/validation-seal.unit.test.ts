import { describe, expect, test } from "bun:test";
import {
	isResourceValidated,
	keepsValidationOnEdit,
	validationSealOnStatusChange,
} from "./validation-seal.ts";

// Issue #420, ADR-0049 (adenda 2026-11-16): reglas del sello «Validado».

describe("validationSealOnStatusChange", () => {
	test("«Aprobar y publicar» (review → published) pone el sello", () => {
		expect(validationSealOnStatusChange("review", "published")).toBe("grant");
	});

	test("publicar directamente desde borrador no lo pone", () => {
		expect(validationSealOnStatusChange("draft", "published")).toBe("keep");
	});

	test("archivar lo conserva y restaurar a borrador lo quita", () => {
		expect(validationSealOnStatusChange("published", "archived")).toBe("keep");
		expect(validationSealOnStatusChange("archived", "draft")).toBe("revoke");
	});

	test("volver a revisión o a borrador lo quita", () => {
		expect(validationSealOnStatusChange("review", "draft")).toBe("revoke");
		expect(validationSealOnStatusChange("draft", "review")).toBe("revoke");
	});
});

describe("keepsValidationOnEdit", () => {
	test("curator y admin conservan el sello al editar", () => {
		expect(keepsValidationOnEdit("curator")).toBe(true);
		expect(keepsValidationOnEdit("admin")).toBe(true);
	});

	test("el resto de roles lo quitan", () => {
		for (const role of ["editor", "author", "reader", undefined, null]) {
			expect(keepsValidationOnEdit(role)).toBe(false);
		}
	});
});

describe("isResourceValidated", () => {
	test("solo cuenta en un recurso publicado con fecha de validación", () => {
		const at = new Date("2026-11-16T10:00:00Z");
		expect(
			isResourceValidated({ editorialStatus: "published", validatedAt: at }),
		).toBe(true);
		expect(
			isResourceValidated({
				editorialStatus: "published",
				validatedAt: "2026-11-16T10:00:00Z",
			}),
		).toBe(true);
		expect(
			isResourceValidated({ editorialStatus: "archived", validatedAt: at }),
		).toBe(false);
		expect(
			isResourceValidated({ editorialStatus: "published", validatedAt: null }),
		).toBe(false);
		expect(isResourceValidated({ editorialStatus: "published" })).toBe(false);
	});
});
