import { describe, expect, test } from "bun:test";
import { normalizeLegacyPublicatorEmail } from "./publicator-email.ts";

// #456: en el Procomún antiguo el correo es el identificador único de la
// cuenta, y cada ODE lo trae en `publicatorEmailStr`.
describe("normalizeLegacyPublicatorEmail", () => {
	test("quita espacios y pasa a minúsculas", () => {
		expect(normalizeLegacyPublicatorEmail("  Docente.Uno@Ejemplo.TEST ")).toBe(
			"docente.uno@ejemplo.test",
		);
	});

	test("devuelve null si el campo falta, está vacío o no es texto", () => {
		expect(normalizeLegacyPublicatorEmail(undefined)).toBeNull();
		expect(normalizeLegacyPublicatorEmail(null)).toBeNull();
		expect(normalizeLegacyPublicatorEmail("   ")).toBeNull();
		expect(normalizeLegacyPublicatorEmail(42)).toBeNull();
	});
});
