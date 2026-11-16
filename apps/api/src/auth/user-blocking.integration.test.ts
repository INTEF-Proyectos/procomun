import { beforeAll, describe, expect, test } from "bun:test";
import * as repo from "@procomun/db/repository";
import { user } from "@procomun/db/schema";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, waitForDb } from "../db.ts";
import { adminRoutes } from "../routes/admin/index.ts";
import { auth } from "./config.ts";
import type { AuthEnv } from "./middleware.ts";
import { tokenAuthMiddleware } from "./token-auth.ts";

/*
 * Estado «bloqueado» de una cuenta (issue #456): la administración lo pone y
 * lo quita, y vale igual para cuentas nuevas e importadas.
 */
const PASSWORD = "Bloqueo-2026!";
const ORIGIN = "http://localhost:4321";

function adminApp(admin: { id: string; role: string }) {
	const app = new Hono<AuthEnv>();
	app.use("*", async (c, next) => {
		c.set("user", admin as unknown as AuthEnv["Variables"]["user"]);
		c.set("session", { id: "s" } as AuthEnv["Variables"]["session"]);
		await next();
	});
	app.route("/api/admin", adminRoutes);
	return app;
}

function tokenApp() {
	const app = new Hono<AuthEnv>();
	app.use("*", async (c, next) => {
		c.set("user", null);
		c.set("session", null);
		await next();
	});
	app.use("*", tokenAuthMiddleware);
	app.get("/test", (c) => c.json({ userId: c.get("user")?.id ?? null }));
	return app;
}

async function createAccount(label: string) {
	const email = `${label}-${crypto.randomUUID()}@example.test`;
	const created = await repo.createUserWithCredentials(getDb().db, {
		email,
		name: `Usuaria ${label}`,
		role: "author",
		passwordHash: await hashPassword(PASSWORD),
	});
	if (!created) throw new Error("no se pudo crear la cuenta de prueba");
	return { id: created.id, email };
}

function signIn(email: string) {
	return auth.handler(
		new Request(`${ORIGIN}/api/auth/sign-in/email`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: ORIGIN },
			body: JSON.stringify({ email, password: PASSWORD }),
		}),
	);
}

async function sessionFrom(res: Response) {
	const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]);
	return auth.api.getSession({
		headers: new Headers({ cookie: cookie.join("; ") }),
	});
}

function setBlocked(userId: string, blocked: boolean) {
	return adminApp({ id: "1", role: "admin" }).request(
		`/api/admin/users/${userId}`,
		{
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ isActive: !blocked }),
		},
	);
}

describe("bloquear y desbloquear cuentas desde la administración", () => {
	beforeAll(async () => {
		await waitForDb();
	});

	test("un bloqueado no inicia sesión, pierde sus sesiones y sus tokens", async () => {
		const account = await createAccount("bloqueada");
		const login = await signIn(account.email);
		expect(login.status).toBe(200);
		expect(await sessionFrom(login)).not.toBeNull();
		const token = await repo.createApiToken(getDb().db, {
			userId: account.id,
			name: "token-bloqueo",
		});
		const withToken = () =>
			tokenApp().request("/test", {
				headers: { Authorization: `Bearer ${token.rawToken}` },
			});
		expect((await withToken()).status).toBe(200);

		expect((await setBlocked(account.id, true)).status).toBe(200);

		// La sesión abierta deja de valer.
		expect(await sessionFrom(login)).toBeNull();
		// No puede volver a entrar, con un mensaje claro.
		const denied = await signIn(account.email);
		expect(denied.status).toBe(403);
		const body = (await denied.json()) as { code?: string; message?: string };
		expect(body.code).toBe("BANNED_USER");
		expect(body.message).toContain("bloqueada");
		// Su token de API tampoco.
		expect((await withToken()).status).toBe(403);
	});

	test("desbloquear restaura el acceso", async () => {
		const account = await createAccount("desbloqueada");
		await setBlocked(account.id, true);
		expect((await signIn(account.email)).status).toBe(403);

		expect((await setBlocked(account.id, false)).status).toBe(200);

		const login = await signIn(account.email);
		expect(login.status).toBe(200);
		expect(await sessionFrom(login)).not.toBeNull();
	});

	test("una cuenta desactivada antes de unificar el estado tampoco entra", async () => {
		// Datos previos: is_active = false sin banned.
		const account = await createAccount("antigua");
		await getDb()
			.db.update(user)
			.set({ isActive: false })
			.where(eq(user.id, account.id));

		const denied = await signIn(account.email);
		expect(denied.status).toBe(403);
		const body = (await denied.json()) as { message?: string };
		expect(body.message).toContain("bloqueada");
	});

	test("la administración no puede bloquear su propia cuenta", async () => {
		const admin = await createAccount("admin-propia");
		await repo.updateUser(getDb().db, admin.id, { role: "admin" });

		const res = await adminApp({ id: admin.id, role: "admin" }).request(
			`/api/admin/users/${admin.id}`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ isActive: false }),
			},
		);
		expect(res.status).toBe(400);
		const [row] = await getDb()
			.db.select()
			.from(user)
			.where(eq(user.id, admin.id));
		expect(row?.isActive).toBeTrue();
		expect(row?.banned).toBeFalse();
	});

	test("los recursos publicados de un bloqueado siguen visibles con su autoría", async () => {
		const account = await createAccount("autora");
		const db = getDb().db;
		const { id } = await repo.createResource(db, {
			title: `Recurso de autora bloqueada ${crypto.randomUUID()}`,
			description: "Descripción",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			author: "Autora",
			createdBy: account.id,
			editorialStatus: "published",
		});
		const before = await repo.getResourceById(db, id);

		await setBlocked(account.id, true);

		const after = await repo.getResourceBySlug(db, before?.slug ?? "");
		expect(after?.editorialStatus).toBe("published");
		expect(after?.createdByName).toBe("Usuaria autora");
	});
});
