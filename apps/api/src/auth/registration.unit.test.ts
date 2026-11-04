import { afterAll, describe, expect, test } from "bun:test";
import * as repo from "@procomun/db/repository";
import { Hono } from "hono";
import { getDb } from "../db.ts";
import { userRoutes } from "../routes/admin/users.ts";
import { auth, createAuth } from "./config.ts";
import type { AuthEnv } from "./middleware.ts";
import { getAuthBaseUrl, getFrontendUrl } from "./urls.ts";

// Rol inicial de las cuentas nuevas (#515): se prueba contra la instancia real
// de Better Auth y la base de datos PGlite de los tests.

const baseUrl = getAuthBaseUrl();
const origin = getFrontendUrl();
const password = "contrasena-segura-1";

function newEmail(prefix: string) {
	return `${prefix}-${crypto.randomUUID()}@registro.test`;
}

function authRequest(
	instance: { handler: (request: Request) => Promise<Response> },
	path: string,
	init: { method?: string; body?: unknown; cookie?: string } = {},
) {
	const headers: Record<string, string> = { Origin: origin };
	if (init.body !== undefined) headers["Content-Type"] = "application/json";
	if (init.cookie) headers.Cookie = init.cookie;
	return instance.handler(
		new Request(`${baseUrl}/api/auth${path}`, {
			method: init.method ?? "POST",
			headers,
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
		}),
	);
}

/** Convierte los Set-Cookie de una respuesta en una cabecera Cookie. */
function cookieHeader(res: Response) {
	return res.headers
		.getSetCookie()
		.map((cookie) => cookie.split(";")[0])
		.join("; ");
}

async function storedRole(email: string) {
	return (await repo.getUserByEmail(getDb().db, email))?.role ?? null;
}

async function signUp(body: Record<string, unknown>) {
	return authRequest(auth, "/sign-up/email", { body });
}

async function signIn(email: string) {
	const res = await authRequest(auth, "/sign-in/email", {
		body: { email, password },
	});
	expect(res.status).toBe(200);
	return cookieHeader(res);
}

describe("registro con email y contraseña (#515)", () => {
	test("la cuenta nueva se guarda con el rol editor", async () => {
		const email = newEmail("registro");
		const res = await signUp({ name: "Docente", email, password });

		expect(res.status).toBe(200);
		expect(await storedRole(email)).toBe("editor");
	});

	test("la sesión de la cuenta nueva lleva el rol editor", async () => {
		const email = newEmail("sesion");
		expect((await signUp({ name: "Docente", email, password })).status).toBe(
			200,
		);

		const cookie = await signIn(email);
		const session = await authRequest(auth, "/get-session", {
			method: "GET",
			cookie,
		});
		const body = (await session.json()) as { user?: { role?: string } };
		expect(body.user?.role).toBe("editor");
	});

	for (const role of ["admin", "curator", "author", "reader"]) {
		test(`una petición con role: "${role}" se rechaza y no crea la cuenta`, async () => {
			const email = newEmail(`manipulado-${role}`);
			const res = await signUp({ name: "Intruso", email, password, role });

			expect(res.status).toBe(400);
			expect(await storedRole(email)).toBeNull();
		});
	}

	test("iniciar sesión no cambia el rol de una cuenta existente", async () => {
		const email = newEmail("existente");
		expect((await signUp({ name: "Antigua", email, password })).status).toBe(
			200,
		);
		const created = await repo.getUserByEmail(getDb().db, email);
		await repo.updateUser(getDb().db, created?.id ?? "", { role: "author" });

		await signIn(email);

		expect(await storedRole(email)).toBe("author");
	});
});

describe("registro con OIDC (#515)", () => {
	// Proveedor OIDC mínimo: discovery, token y userinfo. El perfil intenta
	// colar un rol para comprobar que el registro no lo usa.
	let profile: Record<string, unknown> = {};
	const provider = Bun.serve({
		port: 0,
		fetch(request): Response {
			const { origin: issuer, pathname } = new URL(request.url);
			if (pathname === "/.well-known/openid-configuration") {
				return Response.json({
					issuer,
					authorization_endpoint: `${issuer}/authorize`,
					token_endpoint: `${issuer}/token`,
					userinfo_endpoint: `${issuer}/userinfo`,
				});
			}
			if (pathname === "/token") {
				return Response.json({
					access_token: "token-de-prueba",
					token_type: "Bearer",
					expires_in: 3600,
				});
			}
			if (pathname === "/userinfo") return Response.json(profile);
			return new Response("Not found", { status: 404 });
		},
	});
	afterAll(() => provider.stop(true));

	const oidcAuth = createAuth({
		...process.env,
		OIDC_ENABLED: "true",
		OIDC_ISSUER: provider.url.origin,
		OIDC_CLIENT_ID: "procomun-test",
		OIDC_CLIENT_SECRET: "secreto-de-prueba",
		OIDC_SCOPE: "openid email profile",
	});

	async function signInWithOidc(email: string, extra: Record<string, unknown>) {
		const subject = crypto.randomUUID();
		profile = {
			id: subject,
			sub: subject,
			email,
			email_verified: true,
			name: "Docente OIDC",
			...extra,
		};
		const start = await authRequest(oidcAuth, "/sign-in/social", {
			body: { provider: "oidc", callbackURL: "/" },
		});
		expect(start.status).toBe(200);
		const { url } = (await start.json()) as { url: string };
		const state = new URL(url).searchParams.get("state") ?? "";

		const callback = await authRequest(
			oidcAuth,
			`/callback/oidc?code=codigo-de-prueba&state=${encodeURIComponent(state)}`,
			{ method: "GET", cookie: cookieHeader(start) },
		);
		expect(callback.status).toBe(302);
		expect(callback.headers.get("location") ?? "").not.toContain("error");
	}

	test("la cuenta creada en el primer inicio de sesión es editor", async () => {
		const email = newEmail("oidc");
		await signInWithOidc(email, {});
		expect(await storedRole(email)).toBe("editor");
	});

	test("un rol en el perfil del proveedor no se aplica", async () => {
		const email = newEmail("oidc-admin");
		await signInWithOidc(email, { role: "admin" });
		expect(await storedRole(email)).toBe("editor");
	});
});

describe("altas de administración: no son registro (#515)", () => {
	// Por HTTP este endpoint no puede fijar el rol: ningún rol tiene el permiso
	// `user: set-role` (permissions.ts). Desde el servidor sí, sin sesión.
	test("el alta del plugin admin de Better Auth conserva el rol pedido", async () => {
		const email = newEmail("alta-admin-ba");
		await auth.api.createUser({
			body: { email, password, name: "Curadora", role: "curator" },
		});

		expect(await storedRole(email)).toBe("curator");
	});

	function backofficeApp() {
		const app = new Hono<AuthEnv>();
		app.use("*", async (c, next) => {
			c.set("user", { id: "1", role: "admin" } as AuthEnv["Variables"]["user"]);
			await next();
		});
		app.route("/users", userRoutes);
		return app;
	}

	test("el backoffice mantiene author si el admin no elige rol", async () => {
		const email = newEmail("alta-backoffice");
		const res = await backofficeApp().request("/users", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Sin rol", email, password }),
		});

		expect(res.status).toBe(201);
		expect(await storedRole(email)).toBe("author");
	});

	test("el backoffice guarda el rol que elige el admin", async () => {
		const email = newEmail("alta-backoffice-curator");
		const res = await backofficeApp().request("/users", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: "Curador",
				email,
				password,
				role: "curator",
			}),
		});

		expect(res.status).toBe(201);
		expect(await storedRole(email)).toBe("curator");
	});
});
