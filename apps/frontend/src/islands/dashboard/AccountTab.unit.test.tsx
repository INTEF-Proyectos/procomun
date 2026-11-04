import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	AccountTab,
	validateEmailChange,
	validatePasswordChange,
} from "./AccountTab.tsx";

/**
 * #532: pestaña «Cuenta» del perfil: cambiar la contraseña y el correo. En las
 * cuentas de acceso institucional (OIDC) no se ofrece ninguna de las dos.
 */
describe("validatePasswordChange (#532)", () => {
	test("exige el mínimo de 8", () => {
		expect(validatePasswordChange("actual-123", "corta", "corta")).toBe(
			"too_short",
		);
	});

	test("comprueba la longitud antes que la coincidencia", () => {
		// «No coinciden» cuando además es corta esconde el problema real.
		expect(validatePasswordChange("actual-123", "corta", "otra")).toBe(
			"too_short",
		);
	});

	test("las dos nuevas tienen que coincidir", () => {
		expect(
			validatePasswordChange("actual-123", "nueva-12345", "nueva-54321"),
		).toBe("mismatch");
	});

	test("la nueva no puede ser la actual", () => {
		expect(
			validatePasswordChange("misma-12345", "misma-12345", "misma-12345"),
		).toBe("same");
	});

	test("lo válido no tiene problema", () => {
		expect(
			validatePasswordChange("actual-123", "nueva-12345", "nueva-12345"),
		).toBeNull();
	});
});

describe("validateEmailChange (#532)", () => {
	test("el mismo correo, sin distinguir mayúsculas ni espacios, no cuenta", () => {
		// Better Auth guarda el correo normalizado (config.ts lo pasa a
		// minúsculas al crear la cuenta).
		expect(validateEmailChange("ana@ejemplo.test", "  Ana@Ejemplo.TEST ")).toBe(
			"same",
		);
	});

	test("otro correo es válido", () => {
		expect(validateEmailChange("ana@ejemplo.test", "ana@otro.test")).toBeNull();
	});
});

describe("AccountTab (#532)", () => {
	test("con contraseña propia ofrece cambiar la contraseña y el correo", () => {
		const html = renderToStaticMarkup(
			<AccountTab email="ana@ejemplo.test" initialHasPassword={true} />,
		);

		// Actual, nueva y repetición.
		expect(html.split('type="password"').length - 1).toBe(3);
		expect(html).toContain('type="email"');
		expect(html).toContain("ana@ejemplo.test");
	});

	test("los campos de contraseña usan el autocompletado correcto", () => {
		// current-password para que el gestor rellene la actual, new-password
		// para que proponga una nueva y no rellene la vieja.
		const html = renderToStaticMarkup(
			<AccountTab email="ana@ejemplo.test" initialHasPassword={true} />,
		);
		const lower = html.toLowerCase();
		expect(lower).toContain('autocomplete="current-password"');
		expect(lower).toContain('autocomplete="new-password"');
	});

	test("el indicador de fortaleza se anuncia a los lectores de pantalla", () => {
		const html = renderToStaticMarkup(
			<AccountTab email="ana@ejemplo.test" initialHasPassword={true} />,
		);
		expect(html).toContain('aria-live="polite"');
	});

	test("en una cuenta de acceso institucional no ofrece ninguna de las dos", () => {
		const html = renderToStaticMarkup(
			<AccountTab email="ana@ejemplo.test" initialHasPassword={false} />,
		);

		expect(html).not.toContain('type="password"');
		expect(html).not.toContain('type="email"');
		expect(html).toContain("institucional");
	});

	test("mientras no sabe qué cuenta es, no enseña formularios", () => {
		// Ofrecer cambiar una contraseña que no existe acaba en error.
		const html = renderToStaticMarkup(<AccountTab email="ana@ejemplo.test" />);
		expect(html).not.toContain('type="password"');
	});
});
