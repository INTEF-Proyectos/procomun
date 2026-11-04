import { describe, expect, test } from "bun:test";
import { MIN_PASSWORD_LENGTH, passwordStrength } from "./password-strength.ts";

/**
 * #532: indicador de fortaleza de la contraseña nueva. Orientativo: lo que
 * de verdad se exige es la longitud mínima de Better Auth. No añade ninguna
 * dependencia (zxcvbn pesa 800 kB para esto).
 */
describe("passwordStrength (#532)", () => {
	test("por debajo del mínimo es «too_short», no un nivel de fortaleza", () => {
		// Si no, una contraseña rechazada saldría como «débil» y parecería válida.
		expect(passwordStrength("")).toBe("too_short");
		expect(passwordStrength("a".repeat(MIN_PASSWORD_LENGTH - 1))).toBe(
			"too_short",
		);
	});

	test("el mínimo coincide con minPasswordLength de Better Auth", () => {
		expect(MIN_PASSWORD_LENGTH).toBe(8);
	});

	test("solo letras minúsculas, aunque llegue al mínimo, es débil", () => {
		expect(passwordStrength("abcdefgh")).toBe("weak");
	});

	test("mezclar tipos de caracteres sube el nivel", () => {
		expect(passwordStrength("abcdEF12")).toBe("fair");
		expect(passwordStrength("abcdEF12!?")).toBe("strong");
	});

	test("la longitud también cuenta: una frase larga es fuerte", () => {
		// Lo que recomiendan las guías actuales: frases largas mejor que
		// combinaciones cortas raras.
		expect(passwordStrength("una frase larga de cuatro palabras")).toBe(
			"strong",
		);
	});

	test("repetir un solo carácter no es fuerte por largo que sea", () => {
		expect(passwordStrength("aaaaaaaaaaaaaaaaaaaaaaaa")).toBe("weak");
	});
});
