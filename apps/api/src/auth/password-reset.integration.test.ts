import { beforeAll, describe, expect, test } from "bun:test";
import { account, user } from "@procomun/db/schema";
import { eq } from "drizzle-orm";
import { getDb, waitForDb } from "../db.ts";
import {
	buildPasswordResetOptions,
	type EmailMessage,
} from "../email/transport.ts";
import { redactAuditPath } from "./audit.ts";
import { createAuth } from "./config.ts";
import { isLegacyPasswordHash } from "./legacy-password.ts";

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

	// Revisión de #551: los tests de arriba usan una URL sintética. La que
	// genera Better Auth lleva el token en la RUTA, y esa petición pasa por la
	// auditoría antes de redirigir a /restablecer?token=…
	test("el enlace real del correo no deja el token en la auditoría", async () => {
		const ctx = await auth.$context;
		const options = ctx.options.emailAndPassword as {
			sendResetPassword: (data: {
				user: { email: string };
				url: string;
			}) => Promise<void>;
		};
		const original = options.sendResetPassword;
		let url = "";
		options.sendResetPassword = async (data) => {
			url = data.url;
		};
		try {
			await auth.api.requestPasswordReset({
				body: { email: EMAIL, redirectTo: "/restablecer" },
			});
		} finally {
			options.sendResetPassword = original;
		}

		const { pathname } = new URL(url);
		const token = pathname.split("/").pop() ?? "";
		expect(pathname).toBe(`/api/auth/reset-password/${token}`);
		expect(token.length).toBeGreaterThan(10);
		expect(redactAuditPath(pathname)).toBe("/api/auth/reset-password/:token");
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

// Al poner al día #551 con #488: los importados entran con su hash heredado
// hasta que restablecen. Tras el restablecimiento la contraseña antigua no
// puede volver a valer.
describe("restablecer deja inservible el hash heredado (#551, #488)", () => {
	const BCRYPT_2Y =
		"$2y$10$NtYFUMRmtbKJyE.veX1nmuA5DC9GdFsrZVaUp6y6hIbFd5VDp//xi";
	const OLD_PASSWORD = "Procomun-2026!";
	const NEW_PASSWORD = "restablecida-551-488";

	test("la contraseña heredada deja de valer y el hash pasa a better-auth", async () => {
		await waitForDb();
		const auth = createAuth(process.env);
		const { db } = getDb();
		const id = `legacy-procomun:user:${crypto.randomUUID()}`;
		const email = `heredado-${crypto.randomUUID()}@issue531.test`;
		const now = new Date();
		await db.insert(user).values({
			id,
			email,
			emailVerified: false,
			name: "Heredado",
			role: "author",
			isActive: true,
			createdAt: now,
			updatedAt: now,
		});
		await db.insert(account).values({
			id: `${id}:account`,
			userId: id,
			accountId: id,
			providerId: "credential",
			password: BCRYPT_2Y,
			createdAt: now,
			updatedAt: now,
		});

		const ctx = await auth.$context;
		const token = `t-${crypto.randomUUID()}`;
		await ctx.internalAdapter.createVerificationValue({
			value: id,
			identifier: `reset-password:${token}`,
			expiresAt: new Date(Date.now() + 60_000),
		});
		const res = await auth.api.resetPassword({
			body: { token, newPassword: NEW_PASSWORD },
			asResponse: true,
		});
		expect(res.status).toBe(200);

		const rows = await db
			.select({ password: account.password })
			.from(account)
			.where(eq(account.userId, id));
		expect(isLegacyPasswordHash(rows[0]?.password ?? "")).toBeFalse();

		const oldSignIn = await auth.api.signInEmail({
			body: { email, password: OLD_PASSWORD },
			asResponse: true,
		});
		expect(oldSignIn.status).toBe(401);
		const newSignIn = await auth.api.signInEmail({
			body: { email, password: NEW_PASSWORD },
			asResponse: true,
		});
		expect(newSignIn.status).toBe(200);
	});
});
