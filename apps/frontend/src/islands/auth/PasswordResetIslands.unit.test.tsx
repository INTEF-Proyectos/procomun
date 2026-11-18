import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LoginIsland } from "./LoginIsland.tsx";
import {
	ForgotPasswordIsland,
	ResetPasswordIsland,
	readResetToken,
	validateNewPassword,
} from "./PasswordResetIslands.tsx";

/**
 * #531: no habia forma de recuperar una contraseña olvidada. Es la unica via
 * de entrada de los usuarios importados cuya contraseña no se puede traer
 * (#488).
 */
describe("readResetToken (#531)", () => {
	test("lee el token del fragmento", () => {
		expect(readResetToken("#token=abc123")).toBe("abc123");
	});

	test("acepta la query de los correos enviados antes del cambio", () => {
		expect(readResetToken("", "?token=abc123")).toBe("abc123");
	});

	test("sin token devuelve null, para no enseñar el formulario", () => {
		expect(readResetToken("", "")).toBeNull();
		expect(readResetToken("#otra=cosa", "?otra=cosa")).toBeNull();
		expect(readResetToken("#token=")).toBeNull();
	});

	test("better-auth puede devolver el error en la query en vez del token", () => {
		// Enlace caducado o ya usado: better-auth redirige con ?error=...
		expect(readResetToken("", "?error=INVALID_TOKEN")).toBeNull();
	});
});

describe("validateNewPassword (#531)", () => {
	test("exige los 8 caracteres de la politica", () => {
		// El minPasswordLength de better-auth es 8: el mismo numero aqui.
		expect(validateNewPassword("1234567", "1234567")).toBe("too_short");
		expect(validateNewPassword("12345678", "12345678")).toBeNull();
	});

	test("exige que las dos coincidan", () => {
		expect(validateNewPassword("contrasena-larga", "otra-contrasena")).toBe(
			"mismatch",
		);
	});

	test("comprueba la longitud antes que la coincidencia", () => {
		// Decir «no coinciden» cuando ademas es corta esconde el problema real.
		expect(validateNewPassword("corta", "distinta")).toBe("too_short");
	});
});

describe("ForgotPasswordIsland (#531)", () => {
	const html = renderToStaticMarkup(<ForgotPasswordIsland />);

	test("pide el correo y nada mas", () => {
		expect(html).toContain('type="email"');
		expect(html).toContain("required");
		// Sin contraseña: aqui no se inicia sesion.
		expect(html).not.toContain('type="password"');
	});

	test("tiene vuelta al acceso, para no dejar a nadie encerrado", () => {
		expect(html).toContain("login");
	});
});

describe("ResetPasswordIsland (#531)", () => {
	test("sin token no enseña el formulario y dice como pedir otro enlace", () => {
		const html = renderToStaticMarkup(
			<ResetPasswordIsland hash="" search="" />,
		);

		expect(html).not.toContain('type="password"');
		expect(html).toContain("login");
	});

	test("con token pide la contraseña dos veces", () => {
		const html = renderToStaticMarkup(
			<ResetPasswordIsland hash="#token=abc" />,
		);

		const campos = html.split('type="password"').length - 1;
		expect(campos).toBe(2);
	});

	test("el token no se pinta en el HTML", () => {
		// Da acceso a la cuenta: no tiene que acabar en el DOM ni en una captura.
		const html = renderToStaticMarkup(
			<ResetPasswordIsland hash="#token=secreto-de-un-solo-uso" />,
		);

		expect(html).not.toContain("secreto-de-un-solo-uso");
	});
});

// El enlace del acceso es la mitad de la issue: sin el, las dos pantallas
// nuevas existen pero nadie llega a ellas.
describe("enlace desde el acceso (#531)", () => {
	test("la pantalla de acceso enlaza a /recuperar", () => {
		const html = renderToStaticMarkup(<LoginIsland />);

		expect(html).toContain("recuperar");
		expect(html).toContain("olvidado");
	});
});
