import { describe, expect, test } from "bun:test";
import { statusChangeFeedback } from "./status-change-errors.ts";

describe("statusChangeFeedback (#408)", () => {
	test("reparte los campos que faltan y los nombra todos en el mensaje", () => {
		const feedback = statusChangeFeedback({
			error: "Validación fallida",
			details: [
				{ field: "description", message: "La descripción es obligatoria" },
				{ field: "resourceType", message: "El tipo de recurso es obligatorio" },
			],
		});
		expect(feedback.fieldErrors).toEqual({
			description: "La descripción es obligatoria",
			resourceType: "El tipo de recurso es obligatorio",
		});
		expect(feedback.message).toContain("La descripción es obligatoria");
		expect(feedback.message).toContain("El tipo de recurso es obligatorio");
	});

	test("sin detalles usa el error del servidor o un mensaje genérico", () => {
		expect(statusChangeFeedback({ error: "Transición no permitida" })).toEqual({
			message: "Transición no permitida",
			fieldErrors: {},
		});
		expect(statusChangeFeedback(new TypeError("fetch failed"))).toEqual({
			message: "Error al cambiar el estado",
			fieldErrors: {},
		});
	});
});
