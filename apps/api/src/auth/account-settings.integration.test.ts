import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { account, user } from "@procomun/db/schema";
import { eq } from "drizzle-orm";
import { getDb } from "../db.ts";
import { auth, createAuth } from "./config.ts";
import { isLegacyPasswordHash } from "./legacy-password.ts";
import { getAuthBaseUrl, getFrontendUrl } from "./urls.ts";

/**
 * #532: pestaña «Cuenta». Se prueba contra la instancia real de Better Auth y
 * la base PGlite de los tests: cambiar la contraseña y el correo, y que el
 * correo no cambie nunca sin verificar la dirección nueva.
 */

const baseUrl = getAuthBaseUrl();
const origin = getFrontendUrl();
const PASSWORD = "contrasena-actual-532";

function freshEmail(prefix: string) {
	return `${prefix}-${crypto.randomUUID()}@cuenta532.test`;
}

function authRequest(
	path: string,
	init: { method?: string; body?: unknown; cookie?: string } = {},
) {
	const headers: Record<string, string> = { Origin: origin };
	if (init.body !== undefined) headers["Content-Type"] = "application/json";
	if (init.cookie) headers.Cookie = init.cookie;
	return auth.handler(
		new Request(`${baseUrl}/api/auth${path}`, {
			method: init.method ?? "POST",
			headers,
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
		}),
	);
}

function cookieFrom(res: Response) {
	return res.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ");
}

/** Crea una cuenta y devuelve la cookie de una sesión abierta. */
async function signedUp(prefix: string, { verified = false } = {}) {
	const email = freshEmail(prefix);
	const signUp = await authRequest("/sign-up/email", {
		body: { email, password: PASSWORD, name: "Cuenta 532" },
	});
	expect([200, 201]).toContain(signUp.status);
	if (verified) {
		await getDb()
			.db.update(user)
			.set({ emailVerified: true })
			.where(eq(user.email, email));
	}
	const signIn = await authRequest("/sign-in/email", {
		body: { email, password: PASSWORD },
	});
	expect(signIn.status).toBe(200);
	return { email, cookie: cookieFrom(signIn) };
}

async function storedEmail(email: string) {
	const rows = await getDb()
		.db.select({ email: user.email })
		.from(user)
		.where(eq(user.email, email));
	return rows[0]?.email ?? null;
}

/** Correos enviados por el transporte de log de los tests. */
function captureEmails() {
	const sent: string[] = [];
	const spy = spyOn(console, "log").mockImplementation((line: unknown) => {
		if (typeof line === "string" && line.startsWith("[email]")) sent.push(line);
	});
	return { sent, spy };
}

let restore: (() => void) | undefined;
afterEach(() => {
	restore?.();
	restore = undefined;
});

describe("cambiar la contraseña (#532)", () => {
	test("con la contraseña actual correcta, la nueva sustituye a la vieja", async () => {
		const { email, cookie } = await signedUp("pwd-ok");

		const res = await authRequest("/change-password", {
			cookie,
			body: {
				currentPassword: PASSWORD,
				newPassword: "contrasena-nueva-532",
			},
		});
		expect(res.status).toBe(200);

		const vieja = await authRequest("/sign-in/email", {
			body: { email, password: PASSWORD },
		});
		expect(vieja.status).not.toBe(200);
		const nueva = await authRequest("/sign-in/email", {
			body: { email, password: "contrasena-nueva-532" },
		});
		expect(nueva.status).toBe(200);
	});

	test("con la contraseña actual equivocada no cambia nada", async () => {
		const { email, cookie } = await signedUp("pwd-mal");

		const res = await authRequest("/change-password", {
			cookie,
			body: {
				currentPassword: "no-es-la-mia",
				newPassword: "contrasena-nueva-532",
			},
		});
		expect(res.status).not.toBe(200);
		// El cliente (http-api-client.ts) se fía de este código para decir
		// «la contraseña actual no es correcta»: se fija aquí contra la
		// instancia real para que un cambio de Better Auth no lo rompa a ciegas.
		expect((await res.json()).code).toBe("INVALID_PASSWORD");

		const sigue = await authRequest("/sign-in/email", {
			body: { email, password: PASSWORD },
		});
		expect(sigue.status).toBe(200);
	});

	test("cierra las demás sesiones abiertas", async () => {
		// Quien cambia la contraseña porque sospecha que se la han robado
		// necesita que la otra sesión deje de valer.
		const { email, cookie } = await signedUp("pwd-revoca");
		const otra = await authRequest("/sign-in/email", {
			body: { email, password: PASSWORD },
		});
		const otraCookie = cookieFrom(otra);

		const res = await authRequest("/change-password", {
			cookie,
			body: {
				currentPassword: PASSWORD,
				newPassword: "contrasena-nueva-532",
				revokeOtherSessions: true,
			},
		});
		expect(res.status).toBe(200);

		const session = await authRequest("/get-session", {
			method: "GET",
			cookie: otraCookie,
		});
		const body = await session.json().catch(() => null);
		expect(body?.user ?? null).toBeNull();
	});
});

// Al poner #552 al día con #488: una cuenta importada puede seguir con el hash
// heredado aunque tenga sesión (la sustitución al entrar falló y se reintenta
// en el siguiente inicio de sesión). Cambiar la contraseña tiene que aceptar
// la heredada como actual y dejarla inservible.
describe("cambiar la contraseña con el hash heredado (#552, #488)", () => {
	const BCRYPT_2Y =
		"$2y$10$NtYFUMRmtbKJyE.veX1nmuA5DC9GdFsrZVaUp6y6hIbFd5VDp//xi";
	const LEGACY_PASSWORD = "Procomun-2026!";

	async function storedHash(userId: string) {
		const rows = await getDb()
			.db.select({ password: account.password })
			.from(account)
			.where(eq(account.userId, userId));
		return rows[0]?.password ?? null;
	}

	test("acepta la heredada como actual y después ya no vale", async () => {
		const email = freshEmail("heredada");
		const signUp = await authRequest("/sign-up/email", {
			body: { email, password: LEGACY_PASSWORD, name: "Heredada 532" },
		});
		expect([200, 201]).toContain(signUp.status);
		const cookie = cookieFrom(signUp);
		const rows = await getDb()
			.db.select({ id: user.id })
			.from(user)
			.where(eq(user.email, email));
		const userId = rows[0]?.id ?? "";
		// La cuenta vuelve al hash del Procomún anterior, como si la
		// sustitución al entrar no hubiera llegado a escribirse.
		await getDb()
			.db.update(account)
			.set({ password: BCRYPT_2Y })
			.where(eq(account.userId, userId));

		const res = await authRequest("/change-password", {
			cookie,
			body: {
				currentPassword: LEGACY_PASSWORD,
				newPassword: "contrasena-nueva-532",
			},
		});
		expect(res.status).toBe(200);
		expect(isLegacyPasswordHash((await storedHash(userId)) ?? "")).toBeFalse();

		const vieja = await authRequest("/sign-in/email", {
			body: { email, password: LEGACY_PASSWORD },
		});
		expect(vieja.status).not.toBe(200);
		const nueva = await authRequest("/sign-in/email", {
			body: { email, password: "contrasena-nueva-532" },
		});
		expect(nueva.status).toBe(200);
	});
});

describe("cambiar el correo (#532)", () => {
	test("está activado: antes daba CHANGE_EMAIL_DISABLED", async () => {
		const { cookie } = await signedUp("mail-activo");
		const res = await authRequest("/change-email", {
			cookie,
			body: { newEmail: freshEmail("destino"), callbackURL: "/perfil" },
		});
		expect(res.status).toBe(200);
	});

	test("sin verificar la dirección nueva, el correo de la cuenta no cambia", async () => {
		const { email, cookie } = await signedUp("mail-pendiente");
		const destino = freshEmail("destino");

		await authRequest("/change-email", {
			cookie,
			body: { newEmail: destino, callbackURL: "/perfil" },
		});

		expect(await storedEmail(email)).toBe(email);
		expect(await storedEmail(destino)).toBeNull();
	});

	test("con el correo verificado, el aviso va primero a la dirección antigua", async () => {
		const { sent, spy } = captureEmails();
		restore = () => spy.mockRestore();
		const { email, cookie } = await signedUp("mail-verificado", {
			verified: true,
		});
		const destino = freshEmail("destino");
		sent.length = 0;

		const res = await authRequest("/change-email", {
			cookie,
			body: { newEmail: destino, callbackURL: "/perfil" },
		});
		expect(res.status).toBe(200);

		// Lo que protege la cuenta si alguien ha robado la sesión.
		expect(sent).toHaveLength(1);
		expect(sent[0]).toContain(`to=${email}`);
		expect(sent[0]).toContain("Confirma el cambio de correo");
		expect(sent[0]).toContain(destino);
	});

	test("cambiar a un correo que ya tiene cuenta no lo delata", async () => {
		const ocupado = await signedUp("mail-ocupado");
		const { cookie } = await signedUp("mail-intruso");

		const aOcupado = await authRequest("/change-email", {
			cookie,
			body: { newEmail: ocupado.email, callbackURL: "/perfil" },
		});
		const aLibre = await authRequest("/change-email", {
			cookie,
			body: { newEmail: freshEmail("libre"), callbackURL: "/perfil" },
		});

		// Mismo código y mismo cuerpo: no sirve para saber qué correos hay.
		expect(aOcupado.status).toBe(aLibre.status);
		expect(await aOcupado.text()).toBe(await aLibre.text());
	});
});

// Revisión de #552: sin transporte de correo no se puede verificar la
// dirección nueva; mejor no ofrecer el cambio que decir «enviado» y fallar.
describe("sin transporte de correo no hay cambio de correo (#552)", () => {
	test("en producción sin SMTP el cambio de correo está apagado", () => {
		const prodAuth = createAuth({
			...process.env,
			NODE_ENV: "production",
			CI: "",
			SMTP_HOST: "",
		});
		const changeEmail = (
			prodAuth.options.user as { changeEmail?: { enabled?: boolean } }
		)?.changeEmail;
		expect(changeEmail?.enabled).toBe(false);
	});
});
