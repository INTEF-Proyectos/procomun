import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { account, user } from "@procomun/db/schema";
import { hashPassword } from "better-auth/crypto";
import { eq, sql } from "drizzle-orm";
import { getDb, waitForDb } from "../db.ts";
import { auth, legacyPasswordAdapter } from "./config.ts";
import {
	isLegacyPasswordHash,
	upgradeLegacyPasswordHash,
} from "./legacy-password.ts";

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

describe("restablecimiento intercalado con la actualización del hash (#488)", () => {
	beforeAll(async () => {
		await waitForDb();
	});

	test("no pisa la contraseña nueva con el hash de la antigua", async () => {
		const legacy = await seedLegacyUser(9004, BCRYPT_2Y);
		const NEW_PASSWORD = "Restablecida-2026!";
		const { internalAdapter } = await auth.$context;
		const adapter = legacyPasswordAdapter(internalAdapter);

		// Entre la lectura del hash legacy y su sustitución, la persona
		// restablece la contraseña (lo mismo que hace /reset-password).
		const upgraded = await upgradeLegacyPasswordHash(
			{
				...adapter,
				findAccounts: async (userId) => {
					const accounts = await adapter.findAccounts(userId);
					await internalAdapter.updatePassword(
						userId,
						await hashPassword(NEW_PASSWORD),
					);
					return accounts;
				},
			},
			{ userId: legacy.id, password: PASSWORD },
		);

		expect(upgraded).toBeFalse();
		expect((await signIn(legacy.email, NEW_PASSWORD)).status).toBe(200);
		expect((await signIn(legacy.email, PASSWORD)).status).toBe(401);
	});
});

describe("fallo al sustituir el hash heredado (#488)", () => {
	const MARKER = "marcador-sensible-488";
	const spies = (["error", "warn", "log", "info", "debug"] as const).map(
		(level) => spyOn(console, level),
	);

	beforeAll(async () => {
		await waitForDb();
	});

	afterEach(async () => {
		for (const spy of spies) spy.mockRestore();
		const { db } = getDb();
		await db.execute(
			sql.raw("DROP TRIGGER IF EXISTS legacy_upgrade_falla ON account"),
		);
		await db.execute(sql.raw("DROP FUNCTION IF EXISTS legacy_upgrade_falla()"));
	});

	test("el inicio de sesión sigue siendo válido y el log no lleva datos del error", async () => {
		const legacy = await seedLegacyUser(9005, BCRYPT_2Y);
		// El UPDATE falla con el marcador y el hash nuevo en el mensaje; el
		// error de Drizzle lleva además la consulta y sus parámetros (hashes).
		const { db } = getDb();
		await db.execute(
			sql.raw(`
				CREATE FUNCTION legacy_upgrade_falla() RETURNS trigger AS $$
				BEGIN
					RAISE EXCEPTION '${MARKER} %', NEW.password;
				END $$ LANGUAGE plpgsql
			`),
		);
		await db.execute(
			sql.raw(`
				CREATE TRIGGER legacy_upgrade_falla BEFORE UPDATE ON account
					FOR EACH ROW WHEN (OLD.user_id = '${legacy.id}')
					EXECUTE FUNCTION legacy_upgrade_falla()
			`),
		);
		for (const spy of spies) spy.mockClear();

		const res = await signIn(legacy.email, PASSWORD);

		expect(res.status).toBe(200);
		expect(await storedHash(legacy.id)).toBe(BCRYPT_2Y);
		const logged = spies
			.flatMap((spy) => spy.mock.calls)
			.map((args) => Bun.inspect(args, { depth: 20 }))
			.join("\n");
		expect(logged).toContain(
			"No se pudo actualizar el hash de una contraseña heredada",
		);
		expect(logged).not.toContain(MARKER);
		expect(logged).not.toContain(BCRYPT_2Y);
		expect(logged).not.toContain('update "account"');
	});
});
