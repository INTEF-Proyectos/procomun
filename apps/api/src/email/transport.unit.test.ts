import { describe, expect, test } from "bun:test";
import {
	allowsLogEmailTransport,
	buildEmailVerificationOptions,
	buildPasswordResetEmail,
	buildPasswordResetOptions,
	buildVerificationEmail,
	type EmailMessage,
	getEmailTransport,
	LogEmailTransport,
	resolveEmailVerificationConfig,
	resolvePasswordResetConfig,
	resolveSmtpConfig,
	SmtpEmailTransport,
} from "./transport.ts";

describe("buildVerificationEmail", () => {
	test("dirige el correo al usuario e incluye el enlace", () => {
		const message = buildVerificationEmail({
			email: "alguien@example.com",
			url: "https://procomun.test/verify?token=abc",
		});
		expect(message.to).toBe("alguien@example.com");
		expect(message.subject).toContain("Verifica");
		expect(message.text).toContain("token=abc");
	});
});

describe("LogEmailTransport", () => {
	test("registra el mensaje fuera de producción", async () => {
		const lines: string[] = [];
		const transport = new LogEmailTransport((line) => lines.push(line));
		await transport.sendEmail({
			to: "dev@example.com",
			subject: "Verifica tu correo",
			text: "Enlace: https://procomun.test/verify?token=xyz",
		});
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("token=xyz");
	});
});

describe("allowsLogEmailTransport", () => {
	test("permite development, test y CI sin entorno desplegado", () => {
		expect(allowsLogEmailTransport({ NODE_ENV: "development" })).toBe(true);
		expect(allowsLogEmailTransport({ NODE_ENV: "test" })).toBe(true);
		expect(allowsLogEmailTransport({ CI: "true" })).toBe(true);
		expect(allowsLogEmailTransport({ CI: "1" })).toBe(true);
	});

	test("rechaza production y staging incluso con CI activo", () => {
		expect(allowsLogEmailTransport({ NODE_ENV: "production" })).toBe(false);
		expect(allowsLogEmailTransport({ NODE_ENV: "staging" })).toBe(false);
		expect(
			allowsLogEmailTransport({ NODE_ENV: "production", CI: "true" }),
		).toBe(false);
		expect(allowsLogEmailTransport({ NODE_ENV: "staging", CI: "true" })).toBe(
			false,
		);
		expect(allowsLogEmailTransport({})).toBe(false);
	});
});

describe("resolveSmtpConfig", () => {
	test("devuelve null sin SMTP_HOST", () => {
		expect(resolveSmtpConfig({})).toBeNull();
	});

	test("construye defaults en development/test", () => {
		const config = resolveSmtpConfig({
			NODE_ENV: "development",
			SMTP_HOST: "smtp.example.com",
		});
		expect(config).toMatchObject({
			host: "smtp.example.com",
			port: 587,
			secure: false,
			from: "no-reply@procomun.local",
		});
	});

	test("respeta configuración explícita", () => {
		const config = resolveSmtpConfig({
			SMTP_HOST: "smtp.example.com",
			SMTP_PORT: "465",
			SMTP_SECURE: "true",
			SMTP_USER: "user",
			SMTP_PASS: "pass",
			MAIL_FROM: "Procomún <hola@example.com>",
		});
		expect(config).toMatchObject({
			port: 465,
			secure: true,
			user: "user",
			pass: "pass",
			from: "Procomún <hola@example.com>",
		});
	});

	test("trata SMTP_PORT vacío como el valor por defecto", () => {
		expect(
			resolveSmtpConfig({
				NODE_ENV: "development",
				SMTP_HOST: "smtp.example.com",
				SMTP_PORT: "",
			}),
		).toMatchObject({ port: 587 });
	});

	test("rechaza puerto, booleano y credenciales parciales", () => {
		// NODE_ENV=development evita el fallo anticipado de MAIL_FROM.
		expect(() =>
			resolveSmtpConfig({
				NODE_ENV: "development",
				SMTP_HOST: "smtp.example.com",
				SMTP_PORT: "0",
			}),
		).toThrow(/SMTP_PORT/);
		expect(() =>
			resolveSmtpConfig({
				NODE_ENV: "development",
				SMTP_HOST: "smtp.example.com",
				SMTP_SECURE: "yes",
			}),
		).toThrow(/SMTP_SECURE/);
		expect(() =>
			resolveSmtpConfig({
				NODE_ENV: "development",
				SMTP_HOST: "smtp.example.com",
				SMTP_USER: "user",
			}),
		).toThrow(/SMTP_USER y SMTP_PASS/);
	});

	test("requiere MAIL_FROM con SMTP fuera de desarrollo/test/CI", () => {
		expect(() =>
			resolveSmtpConfig({
				NODE_ENV: "production",
				SMTP_HOST: "smtp.example.com",
			}),
		).toThrow(/MAIL_FROM/);
		expect(() =>
			resolveSmtpConfig({
				NODE_ENV: "staging",
				SMTP_HOST: "smtp.example.com",
			}),
		).toThrow(/MAIL_FROM/);
	});
});

describe("resolveEmailVerificationConfig", () => {
	test("desactivada por defecto no exige SMTP", () => {
		expect(resolveEmailVerificationConfig({ NODE_ENV: "production" })).toEqual({
			enabled: false,
			expiresIn: 3600,
		});
	});

	test("activar fuera de desarrollo/test/CI sin SMTP falla", () => {
		expect(() =>
			resolveEmailVerificationConfig({
				NODE_ENV: "production",
				AUTH_REQUIRE_EMAIL_VERIFICATION: "true",
			}),
		).toThrow(/requiere SMTP_HOST/);
		expect(() =>
			resolveEmailVerificationConfig({
				NODE_ENV: "staging",
				AUTH_REQUIRE_EMAIL_VERIFICATION: "true",
			}),
		).toThrow(/requiere SMTP_HOST/);
		expect(() =>
			resolveEmailVerificationConfig({
				AUTH_REQUIRE_EMAIL_VERIFICATION: "true",
			}),
		).toThrow(/requiere SMTP_HOST/);
	});

	test("CI no permite saltarse el fail-closed en production o staging", () => {
		expect(() =>
			resolveEmailVerificationConfig({
				NODE_ENV: "production",
				CI: "true",
				AUTH_REQUIRE_EMAIL_VERIFICATION: "true",
			}),
		).toThrow(/requiere SMTP_HOST/);
		expect(() =>
			resolveEmailVerificationConfig({
				NODE_ENV: "staging",
				CI: "true",
				AUTH_REQUIRE_EMAIL_VERIFICATION: "true",
			}),
		).toThrow(/requiere SMTP_HOST/);
	});

	test("activar en test sin SMTP es aceptado (transporte de log)", () => {
		expect(
			resolveEmailVerificationConfig({
				NODE_ENV: "test",
				AUTH_REQUIRE_EMAIL_VERIFICATION: "true",
			}),
		).toEqual({ enabled: true, expiresIn: 3600 });
	});

	test("activar con SMTP válido es aceptado", () => {
		expect(
			resolveEmailVerificationConfig({
				NODE_ENV: "production",
				AUTH_REQUIRE_EMAIL_VERIFICATION: "true",
				EMAIL_VERIFICATION_EXPIRES_IN: "7200",
				SMTP_HOST: "smtp.example.com",
				MAIL_FROM: "Procomún <no-reply@example.com>",
			}),
		).toEqual({ enabled: true, expiresIn: 7200 });
	});

	test("rechaza flag y caducidad inválidos", () => {
		expect(() =>
			resolveEmailVerificationConfig({
				AUTH_REQUIRE_EMAIL_VERIFICATION: "yes",
			}),
		).toThrow(/AUTH_REQUIRE_EMAIL_VERIFICATION/);
		expect(() =>
			resolveEmailVerificationConfig({ EMAIL_VERIFICATION_EXPIRES_IN: "0" }),
		).toThrow(/EMAIL_VERIFICATION_EXPIRES_IN/);
		expect(() =>
			resolveEmailVerificationConfig({ EMAIL_VERIFICATION_EXPIRES_IN: "1h" }),
		).toThrow(/EMAIL_VERIFICATION_EXPIRES_IN/);
	});

	test("una caducidad vacía cae al valor por defecto sin tumbar el arranque", () => {
		expect(
			resolveEmailVerificationConfig({
				NODE_ENV: "production",
				EMAIL_VERIFICATION_EXPIRES_IN: "",
			}),
		).toEqual({ enabled: false, expiresIn: 3600 });
	});
});

describe("buildEmailVerificationOptions", () => {
	test("el flag apagado no envía ni en alta ni en login", () => {
		const options = buildEmailVerificationOptions(
			{ enabled: false, expiresIn: 3600 },
			{ NODE_ENV: "test" },
		);
		expect(options.sendOnSignUp).toBe(false);
		expect(options.sendOnSignIn).toBe(false);
		expect(options.expiresIn).toBe(3600);
	});

	test("el flag activo reenvía la verificación al intentar entrar sin verificar", () => {
		const options = buildEmailVerificationOptions(
			{ enabled: true, expiresIn: 7200 },
			{ NODE_ENV: "test" },
		);
		expect(options.sendOnSignUp).toBe(true);
		expect(options.sendOnSignIn).toBe(true);
		expect(options.autoSignInAfterVerification).toBe(true);
		expect(options.expiresIn).toBe(7200);
	});

	test("sendVerificationEmail entrega el enlace por el transporte del entorno", async () => {
		const options = buildEmailVerificationOptions(
			{ enabled: true, expiresIn: 3600 },
			{ NODE_ENV: "test" },
		);
		const original = console.log;
		const lines: string[] = [];
		console.log = (line: string) => lines.push(line);
		try {
			await options.sendVerificationEmail({
				user: { email: "alguien@example.com" },
				url: "https://procomun.test/verify?token=abc",
			});
		} finally {
			console.log = original;
		}
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain("alguien@example.com");
		expect(lines[0]).toContain("token=abc");
	});

	test("sendVerificationEmail falla en producción sin SMTP en vez de escribir el token", async () => {
		const options = buildEmailVerificationOptions(
			{ enabled: true, expiresIn: 3600 },
			{ NODE_ENV: "production" },
		);
		await expect(
			options.sendVerificationEmail({
				user: { email: "alguien@example.com" },
				url: "https://procomun.test/verify?token=abc",
			}),
		).rejects.toThrow(/SMTP/);
	});
});

describe("getEmailTransport", () => {
	test("usa log en development/test/CI", () => {
		expect(getEmailTransport({ NODE_ENV: "test" })).toBeInstanceOf(
			LogEmailTransport,
		);
		expect(getEmailTransport({ NODE_ENV: "development" })).toBeInstanceOf(
			LogEmailTransport,
		);
		expect(getEmailTransport({ CI: "true" })).toBeInstanceOf(LogEmailTransport);
	});

	test("no degrada a log en production ni en staging sin SMTP", () => {
		expect(() => getEmailTransport({ NODE_ENV: "production" })).toThrow(/SMTP/);
		expect(() => getEmailTransport({ NODE_ENV: "staging" })).toThrow(/SMTP/);
		expect(() =>
			getEmailTransport({ NODE_ENV: "production", CI: "true" }),
		).toThrow(/SMTP/);
		expect(() =>
			getEmailTransport({ NODE_ENV: "staging", CI: "true" }),
		).toThrow(/SMTP/);
		expect(() => getEmailTransport({})).toThrow(/SMTP/);
	});

	test("usa SMTP con configuración válida", () => {
		expect(
			getEmailTransport({
				NODE_ENV: "production",
				SMTP_HOST: "smtp.example.com",
				MAIL_FROM: "Procomún <no-reply@example.com>",
			}),
		).toBeInstanceOf(SmtpEmailTransport);
	});
});

describe("SmtpEmailTransport", () => {
	test("mapea los campos al transporter", async () => {
		const calls: Array<Record<string, unknown>> = [];
		const transport = new SmtpEmailTransport(
			{
				host: "smtp.example.com",
				port: 587,
				secure: false,
				from: "no-reply@procomun.local",
			},
			{
				sendMail: async (options: Record<string, unknown>) => {
					calls.push(options);
					return {};
				},
			},
		);
		await transport.sendEmail({
			to: "user@example.com",
			subject: "Verifica tu correo",
			text: "Enlace de verificación",
			html: "<p>Enlace</p>",
		});
		expect(calls[0]).toMatchObject({
			from: "no-reply@procomun.local",
			to: "user@example.com",
			subject: "Verifica tu correo",
			text: "Enlace de verificación",
			html: "<p>Enlace</p>",
		});
	});
});

// #531: no habia forma de recuperar una contraseña olvidada. ADR-0007 la daba
// por disponible «sin desarrollo adicional», pero `sendResetPassword` no
// estaba configurado. Es la unica via de entrada de los usuarios importados
// cuya contraseña no se puede traer (#488).
describe("buildPasswordResetEmail (#531)", () => {
	test("lleva el enlace y dice que caduca y que es de un solo uso", () => {
		const message = buildPasswordResetEmail({
			email: "autora@ejemplo.test",
			url: "https://procomun.test/restablecer?token=abc",
			expiresIn: 3600,
		});

		expect(message.to).toBe("autora@ejemplo.test");
		expect(message.subject).toContain("Procomún");
		expect(message.text).toContain(
			"https://procomun.test/restablecer?token=abc",
		);
		// Que el usuario sepa que tiene prisa y que el enlace no se reutiliza.
		expect(message.text).toContain("1 hora");
		expect(message.text).toContain("una sola vez");
		// Y que hacer si no lo ha pedido el.
		expect(message.text.toLowerCase()).toContain("no has solicitado");
	});

	test("expresa la caducidad en minutos cuando no llega a una hora", () => {
		const message = buildPasswordResetEmail({
			email: "a@b.test",
			url: "https://procomun.test/restablecer?token=x",
			expiresIn: 900,
		});

		expect(message.text).toContain("15 minutos");
	});

	test("no lleva el correo en el cuerpo, que ya va en el destinatario", () => {
		// Si alguien reenvia el mensaje, no hace falta repetir el dato.
		const message = buildPasswordResetEmail({
			email: "autora@ejemplo.test",
			url: "https://procomun.test/restablecer?token=abc",
			expiresIn: 3600,
		});

		expect(message.text).not.toContain("autora@ejemplo.test");
	});
});

describe("resolvePasswordResetConfig (#531)", () => {
	test("por defecto caduca en una hora", () => {
		expect(resolvePasswordResetConfig({}).expiresIn).toBe(3600);
	});

	test("admite otra caducidad por entorno", () => {
		expect(
			resolvePasswordResetConfig({ PASSWORD_RESET_EXPIRES_IN: "900" })
				.expiresIn,
		).toBe(900);
	});

	test("rechaza una caducidad que no es un entero valido", () => {
		expect(() =>
			resolvePasswordResetConfig({ PASSWORD_RESET_EXPIRES_IN: "cero" }),
		).toThrow();
		expect(() =>
			resolvePasswordResetConfig({ PASSWORD_RESET_EXPIRES_IN: "0" }),
		).toThrow();
	});

	test("no acepta una caducidad larguisima: el enlace da acceso a la cuenta", () => {
		expect(() =>
			resolvePasswordResetConfig({
				PASSWORD_RESET_EXPIRES_IN: String(60 * 60 * 25),
			}),
		).toThrow();
	});
});

describe("buildPasswordResetOptions (#531)", () => {
	test("envia el correo con el enlace que da better-auth", async () => {
		const sent: EmailMessage[] = [];
		const transport = {
			sendEmail: async (message: EmailMessage) => {
				sent.push(message);
			},
		};
		const options = buildPasswordResetOptions(
			{ expiresIn: 3600 },
			{},
			() => transport,
		);

		await options.sendResetPassword({
			user: { email: "autora@ejemplo.test" },
			url: "https://procomun.test/restablecer?token=abc",
		});

		expect(sent).toHaveLength(1);
		expect(sent[0]?.to).toBe("autora@ejemplo.test");
		expect(sent[0]?.text).toContain("token=abc");
	});

	test("expone la caducidad que espera better-auth", () => {
		expect(
			buildPasswordResetOptions({ expiresIn: 900 }, {})
				.resetPasswordTokenExpiresIn,
		).toBe(900);
	});
});
