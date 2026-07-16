import { describe, expect, test } from "bun:test";
import {
	buildVerificationEmail,
	getEmailTransport,
	LogEmailTransport,
	resolveEmailVerificationConfig,
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

describe("resolveSmtpConfig", () => {
	test("devuelve null sin SMTP_HOST", () => {
		expect(resolveSmtpConfig({})).toBeNull();
	});

	test("construye defaults fuera de producción", () => {
		const config = resolveSmtpConfig({ SMTP_HOST: "smtp.example.com" });
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

	test("rechaza puerto, booleano y credenciales parciales", () => {
		expect(() =>
			resolveSmtpConfig({ SMTP_HOST: "smtp.example.com", SMTP_PORT: "0" }),
		).toThrow(/SMTP_PORT/);
		expect(() =>
			resolveSmtpConfig({ SMTP_HOST: "smtp.example.com", SMTP_SECURE: "yes" }),
		).toThrow(/SMTP_SECURE/);
		expect(() =>
			resolveSmtpConfig({ SMTP_HOST: "smtp.example.com", SMTP_USER: "user" }),
		).toThrow(/SMTP_USER y SMTP_PASS/);
	});

	test("requiere MAIL_FROM con SMTP en producción", () => {
		expect(() =>
			resolveSmtpConfig({ NODE_ENV: "production", SMTP_HOST: "smtp.example.com" }),
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

	test("activar en producción sin SMTP falla", () => {
		expect(() =>
			resolveEmailVerificationConfig({
				NODE_ENV: "production",
				AUTH_REQUIRE_EMAIL_VERIFICATION: "true",
			}),
		).toThrow(/requiere SMTP_HOST/);
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
			resolveEmailVerificationConfig({ AUTH_REQUIRE_EMAIL_VERIFICATION: "yes" }),
		).toThrow(/AUTH_REQUIRE_EMAIL_VERIFICATION/);
		expect(() =>
			resolveEmailVerificationConfig({ EMAIL_VERIFICATION_EXPIRES_IN: "0" }),
		).toThrow(/EMAIL_VERIFICATION_EXPIRES_IN/);
	});
});

describe("getEmailTransport", () => {
	test("usa log fuera de producción", () => {
		expect(getEmailTransport({ NODE_ENV: "test" })).toBeInstanceOf(LogEmailTransport);
	});

	test("no degrada a log en producción", () => {
		expect(() => getEmailTransport({ NODE_ENV: "production" })).toThrow(/SMTP/);
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
			{ host: "smtp.example.com", port: 587, secure: false, from: "no-reply@procomun.local" },
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
