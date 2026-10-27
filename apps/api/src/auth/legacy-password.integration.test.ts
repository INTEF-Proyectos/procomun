import { beforeAll, describe, expect, test } from "bun:test";
import { account, user } from "@procomun/db/schema";
import { eq } from "drizzle-orm";
import { getDb, waitForDb } from "../db.ts";
import { auth } from "./config.ts";
import { isLegacyPasswordHash } from "./legacy-password.ts";

/*
 * Inicio de sesión real contra la configuración de better-auth de la API con
 * cuentas importadas del Procomún anterior (issue #456). Los hashes se
 * generaron con PHP para contraseñas de prueba (ver legacy-password.unit.test).
 */
const BCRYPT_2Y =
	"$2y$10$NtYFUMRmtbKJyE.veX1nmuA5DC9GdFsrZVaUp6y6hIbFd5VDp//xi";
const DRUPAL7 = "$S$E6rSBHqMIJwP/yOyG9ctZ0MoaC6ml0ahKsvSQ0lbnRLYBOYSB2Qv";
const PASSWORD = "Procomun-2026!";

async function seedLegacyUser(uid: number, hash: string) {
	const { db } = getDb();
	const id = `legacy-procomun:user:${uid}`;
	const now = new Date();
	await db.insert(user).values({
		id,
		email: `legacy-${uid}@example.test`,
		emailVerified: false,
		name: `Legacy ${uid}`,
		role: "author",
		isActive: true,
		createdAt: now,
		updatedAt: now,
	});
	await db.insert(account).values({
		id: `legacy-procomun:account:${uid}`,
		userId: id,
		accountId: id,
		providerId: "credential",
		password: hash,
		createdAt: now,
		updatedAt: now,
	});
	return { id, email: `legacy-${uid}@example.test` };
}

async function storedHash(userId: string) {
	const rows = await getDb()
		.db.select({ password: account.password })
		.from(account)
		.where(eq(account.userId, userId));
	return rows[0]?.password ?? null;
}

function signIn(email: string, password: string) {
	return auth.handler(
		new Request("http://localhost:4321/api/auth/sign-in/email", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: "http://localhost:4321",
			},
			body: JSON.stringify({ email, password }),
		}),
	);
}

describe("inicio de sesión con contraseñas del Procomún anterior", () => {
	beforeAll(async () => {
		await waitForDb();
	});

	test("bcrypt $2y$: entra con su contraseña y el hash pasa al formato nuevo", async () => {
		const legacy = await seedLegacyUser(9001, BCRYPT_2Y);

		const res = await signIn(legacy.email, PASSWORD);
		expect(res.status).toBe(200);

		const hash = await storedHash(legacy.id);
		expect(hash).not.toBe(BCRYPT_2Y);
		expect(isLegacyPasswordHash(hash ?? "")).toBeFalse();

		// Con el hash nuevo sigue pudiendo entrar, y la incorrecta sigue fallando.
		expect((await signIn(legacy.email, PASSWORD)).status).toBe(200);
		expect((await signIn(legacy.email, "otra-cosa-1")).status).toBe(401);
	});

	test("Drupal 7 $S$: entra con su contraseña y el hash pasa al formato nuevo", async () => {
		const legacy = await seedLegacyUser(9002, DRUPAL7);

		const res = await signIn(legacy.email, PASSWORD);
		expect(res.status).toBe(200);

		const hash = await storedHash(legacy.id);
		expect(hash).not.toBe(DRUPAL7);
		expect(isLegacyPasswordHash(hash ?? "")).toBeFalse();
		expect((await signIn(legacy.email, PASSWORD)).status).toBe(200);
	});

	test("contraseña incorrecta: no entra y el hash antiguo no cambia", async () => {
		const legacy = await seedLegacyUser(9003, DRUPAL7);

		const res = await signIn(legacy.email, "Procomun-2025!");
		expect(res.status).toBe(401);
		expect(await storedHash(legacy.id)).toBe(DRUPAL7);
	});
});
