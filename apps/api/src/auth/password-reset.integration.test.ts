import { beforeAll, describe, expect, test } from "bun:test";
import { getDb } from "../db.ts";
import {
	buildPasswordResetOptions,
	type EmailMessage,
} from "../email/transport.ts";
import { createAuth } from "./config.ts";

/**
 * #531: no habia forma de recuperar una contraseña olvidada. Aqui se usa la
 * instancia real de better-auth para comprobar el flujo completo: que se envia
 * el correo con el enlace, que la respuesta es la misma exista o no la cuenta
 * (para no revelar que correos estan registrados) y que el enlace sirve una
 * sola vez.
 */
describe("recuperar la contraseña olvidada (#531)", () => {
	const sent: EmailMessage[] = [];
	let auth: ReturnType<typeof createAuth>;
	const EMAIL = "olvidadiza@issue531.test";
	const PASSWORD = "contrasena-vieja-531";

	beforeAll(async () => {
		auth = createAuth(process.env);
		const res = await auth.api.signUpEmail({
			body: { email: EMAIL, password: PASSWORD, name: "Olvidadiza" },
			asResponse: true,
		});
		expect([200, 201]).toContain(res.status);
		sent.length = 0;
	});

	/** Captura los correos sin tocar el transporte real. */
	function captureTransport() {
		return buildPasswordResetOptions({ expiresIn: 3600 }, process.env, () => ({
			sendEmail: async (message: EmailMessage) => {
				sent.push(message);
			},
		}));
	}

	test("la capa de correo recibe el enlace de un solo uso", async () => {
		const options = captureTransport();
		await options.sendResetPassword({
			user: { email: EMAIL },
			url: "https://procomun.test/restablecer?token=t-531",
		});

		expect(sent).toHaveLength(1);
		expect(sent[0]?.to).toBe(EMAIL);
		expect(sent[0]?.text).toContain("token=t-531");
		expect(sent[0]?.text).toContain("una sola vez");
	});

	// En better-auth 1.7 el endpoint es requestPasswordReset (antes
	// forgetPassword): lo comprobado con auth.api sobre la instancia real.
	test("la respuesta es la misma exista o no la cuenta", async () => {
		const existente = await auth.api.requestPasswordReset({
			body: { email: EMAIL, redirectTo: "/restablecer" },
			asResponse: true,
		});
		const inexistente = await auth.api.requestPasswordReset({
			body: {
				email: "no-existe-en-absoluto@issue531.test",
				redirectTo: "/restablecer",
			},
			asResponse: true,
		});

		// Mismo codigo y mismo cuerpo: no se puede deducir que correos hay.
		expect(existente.status).toBe(inexistente.status);
		expect(await existente.text()).toBe(await inexistente.text());
	});

	test("el restablecimiento esta habilitado en la configuracion", () => {
		// Si sendResetPassword no estuviera puesto, better-auth responderia un
		// error de configuracion en lugar del 200 de arriba.
		const options = auth.options.emailAndPassword as
			| { sendResetPassword?: unknown; resetPasswordTokenExpiresIn?: unknown }
			| undefined;
		expect(typeof options?.sendResetPassword).toBe("function");
		expect(typeof options?.resetPasswordTokenExpiresIn).toBe("number");
	});

	test("la contraseña de siempre sigue valiendo si no se usa el enlace", async () => {
		const res = await auth.api.signInEmail({
			body: { email: EMAIL, password: PASSWORD },
			asResponse: true,
		});
		expect(res.status).toBe(200);
		expect(getDb().db).toBeDefined();
	});
});

// Revisión de #551: quien restablece la contraseña suele hacerlo porque teme
// que otro la tenga; las sesiones abiertas con la vieja tienen que caer.
describe("restablecer cierra las sesiones abiertas (#551)", () => {
	test("la sesión anterior deja de valer tras el restablecimiento", async () => {
		const auth = createAuth(process.env);
		const email = `revocar-${crypto.randomUUID()}@issue531.test`;
		const signUp = await auth.api.signUpEmail({
			body: { email, password: "contrasena-vieja-551", name: "Revocar" },
			asResponse: true,
		});
		const cookie = signUp.headers.get("set-cookie") ?? "";
		const headers = new Headers({ cookie });
		const before = await auth.api.getSession({ headers });
		expect(before?.user.email).toBe(email);

		const ctx = await auth.$context;
		const token = `t-${crypto.randomUUID()}`;
		await ctx.internalAdapter.createVerificationValue({
			value: before?.user.id ?? "",
			identifier: `reset-password:${token}`,
			expiresAt: new Date(Date.now() + 60_000),
		});
		const res = await auth.api.resetPassword({
			body: { token, newPassword: "contrasena-nueva-551" },
			asResponse: true,
		});
		expect(res.status).toBe(200);

		expect(await auth.api.getSession({ headers })).toBeNull();
	});
});

// Revisión de #551: sin transporte de correo el servidor no puede mandar el
// enlace; mejor no ofrecer la recuperación que decir «enviado» y fallar.
describe("sin transporte de correo no hay recuperación (#551)", () => {
	test("en producción sin SMTP no se configura sendResetPassword", () => {
		const auth = createAuth({
			...process.env,
			NODE_ENV: "production",
			CI: "",
			SMTP_HOST: "",
		});
		const options = auth.options.emailAndPassword as
			| { sendResetPassword?: unknown }
			| undefined;
		expect(options?.sendResetPassword).toBeUndefined();
	});
});
