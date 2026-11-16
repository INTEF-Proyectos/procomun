import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "@procomun/db/schema";
import { createTables } from "@procomun/db/setup";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import {
	isLegacyPasswordHash,
	replaceLegacyPasswordHash,
	upgradeLegacyPasswordHash,
	verifyPasswordWithLegacy,
} from "./legacy-password.ts";

/*
 * Vectores generados con PHP 8 (`password_hash` para bcrypt y un port literal
 * de includes/password.inc de Drupal 7 para `$S$`). No son hashes de usuarios
 * reales: las contraseñas son de prueba.
 */
const BCRYPT_2Y =
	"$2y$10$NtYFUMRmtbKJyE.veX1nmuA5DC9GdFsrZVaUp6y6hIbFd5VDp//xi"; // "Procomun-2026!"
const BCRYPT_2Y_LONG =
	"$2y$04$GHibgFbD/B1AstOFI8r.d.zAFp/dPDjGRBi5rWRBCzndUMn2wW/lG"; // 80 × "a"
const DRUPAL7 = "$S$E6rSBHqMIJwP/yOyG9ctZ0MoaC6ml0ahKsvSQ0lbnRLYBOYSB2Qv"; // "Procomun-2026!", 2^16
const DRUPAL7_UTF8 = "$S$D9j6QWn5vL0me1CUmECcKA5RZpgVGlHHAs3TmdeKFaZ4L2fGH3Ve"; // "contraseña-ñ", 2^15

describe("isLegacyPasswordHash", () => {
	test("reconoce bcrypt de PHP y el formato $S$ de Drupal 7", () => {
		expect(isLegacyPasswordHash(BCRYPT_2Y)).toBeTrue();
		expect(isLegacyPasswordHash(BCRYPT_2Y.replace("$2y$", "$2a$"))).toBeTrue();
		expect(isLegacyPasswordHash(BCRYPT_2Y.replace("$2y$", "$2b$"))).toBeTrue();
		expect(isLegacyPasswordHash(DRUPAL7)).toBeTrue();
	});

	test("no confunde el formato de better-auth ni valores sin formato", async () => {
		expect(isLegacyPasswordHash(await hashPassword("Procomun-2026!"))).toBe(
			false,
		);
		expect(isLegacyPasswordHash("")).toBeFalse();
		expect(isLegacyPasswordHash("$H$9abcdefgh")).toBeFalse();
		expect(isLegacyPasswordHash("$S$Ecorto")).toBeFalse();
	});
});

describe("verifyPasswordWithLegacy", () => {
	test("bcrypt $2y$: acepta la contraseña correcta y rechaza la incorrecta", async () => {
		expect(
			await verifyPasswordWithLegacy({
				hash: BCRYPT_2Y,
				password: "Procomun-2026!",
			}),
		).toBeTrue();
		expect(
			await verifyPasswordWithLegacy({
				hash: BCRYPT_2Y,
				password: "procomun-2026!",
			}),
		).toBeFalse();
	});

	test("bcrypt $2y$ se comporta como PHP con contraseñas de más de 72 bytes", async () => {
		expect(
			await verifyPasswordWithLegacy({
				hash: BCRYPT_2Y_LONG,
				password: "a".repeat(80),
			}),
		).toBeTrue();
		// PHP solo usa los 72 primeros bytes.
		expect(
			await verifyPasswordWithLegacy({
				hash: BCRYPT_2Y_LONG,
				password: "a".repeat(72),
			}),
		).toBeTrue();
		expect(
			await verifyPasswordWithLegacy({
				hash: BCRYPT_2Y_LONG,
				password: "a".repeat(71),
			}),
		).toBeFalse();
	});

	test("Drupal 7 $S$: acepta la contraseña correcta y rechaza la incorrecta", async () => {
		expect(
			await verifyPasswordWithLegacy({
				hash: DRUPAL7,
				password: "Procomun-2026!",
			}),
		).toBeTrue();
		expect(
			await verifyPasswordWithLegacy({
				hash: DRUPAL7,
				password: "Procomun-2026",
			}),
		).toBeFalse();
		expect(
			await verifyPasswordWithLegacy({ hash: DRUPAL7, password: "" }),
		).toBeFalse();
	});

	test("Drupal 7 $S$ trabaja con los bytes UTF-8 de la contraseña", async () => {
		expect(
			await verifyPasswordWithLegacy({
				hash: DRUPAL7_UTF8,
				password: "contraseña-ñ",
			}),
		).toBeTrue();
		expect(
			await verifyPasswordWithLegacy({
				hash: DRUPAL7_UTF8,
				password: "contrasena-n",
			}),
		).toBeFalse();
	});

	test("Drupal 7 $S$ rechaza hashes manipulados o con iteraciones fuera de rango", async () => {
		const tampered = `${DRUPAL7.slice(0, -1)}w`;
		expect(
			await verifyPasswordWithLegacy({
				hash: tampered,
				password: "Procomun-2026!",
			}),
		).toBeFalse();
		// Carácter de iteraciones "4" = 2^6, por debajo del mínimo de Drupal (2^7).
		const tooFew = `$S$4${DRUPAL7.slice(4)}`;
		expect(
			await verifyPasswordWithLegacy({
				hash: tooFew,
				password: "Procomun-2026!",
			}),
		).toBeFalse();
	});

	test("los hashes de better-auth siguen verificándose como siempre", async () => {
		const hash = await hashPassword("Procomun-2026!");
		expect(
			await verifyPasswordWithLegacy({ hash, password: "Procomun-2026!" }),
		).toBeTrue();
		expect(
			await verifyPasswordWithLegacy({ hash, password: "otra" }),
		).toBeFalse();
	});
});

describe("upgradeLegacyPasswordHash", () => {
	// Imita el UPDATE condicional: solo escribe si el hash sigue siendo el leído.
	function fakeAdapter(password: string | null, providerId = "credential") {
		const store = { password };
		const updates: Array<{ credentialId: string; hash: string }> = [];
		return {
			store,
			updates,
			adapter: {
				findAccounts: async (userId: string) => [
					{
						id: `cuenta-${userId}`,
						userId,
						accountId: userId,
						providerId,
						password: store.password,
					},
				],
				replacePasswordHash: async (input: {
					credentialId: string;
					expectedHash: string;
					newHash: string;
				}) => {
					if (store.password !== input.expectedHash) return false;
					store.password = input.newHash;
					updates.push({
						credentialId: input.credentialId,
						hash: input.newHash,
					});
					return true;
				},
			},
		};
	}

	test("sustituye un hash legacy por el formato de better-auth", async () => {
		const { adapter, updates } = fakeAdapter(DRUPAL7);
		const upgraded = await upgradeLegacyPasswordHash(adapter, {
			userId: "legacy-procomun:user:85",
			password: "Procomun-2026!",
		});
		expect(upgraded).toBeTrue();
		expect(updates).toHaveLength(1);
		const newHash = updates[0]?.hash ?? "";
		expect(isLegacyPasswordHash(newHash)).toBeFalse();
		expect(
			await verifyPasswordWithLegacy({
				hash: newHash,
				password: "Procomun-2026!",
			}),
		).toBeTrue();
	});

	test("pide el cambio solo si el hash sigue siendo el legacy verificado", async () => {
		const { adapter, store, updates } = fakeAdapter(BCRYPT_2Y);
		const reset = await hashPassword("Restablecida-2026!");
		const upgraded = await upgradeLegacyPasswordHash(
			{
				...adapter,
				findAccounts: async (userId) => {
					const accounts = await adapter.findAccounts(userId);
					store.password = reset; // restablecimiento intercalado
					return accounts;
				},
			},
			{ userId: "u1", password: "Procomun-2026!" },
		);
		expect(upgraded).toBeFalse();
		expect(updates).toHaveLength(0);
		expect(store.password).toBe(reset);
	});

	test("no toca hashes que ya están en el formato nuevo", async () => {
		const { adapter, updates } = fakeAdapter(await hashPassword("x12345678"));
		expect(
			await upgradeLegacyPasswordHash(adapter, {
				userId: "u1",
				password: "x12345678",
			}),
		).toBeFalse();
		expect(updates).toHaveLength(0);
	});

	test("no actualiza si la contraseña no corresponde al hash legacy", async () => {
		const { adapter, updates } = fakeAdapter(BCRYPT_2Y);
		expect(
			await upgradeLegacyPasswordHash(adapter, {
				userId: "u1",
				password: "incorrecta",
			}),
		).toBeFalse();
		expect(updates).toHaveLength(0);
	});

	test("ignora cuentas que no son de credenciales", async () => {
		const { adapter, updates } = fakeAdapter(BCRYPT_2Y, "oidc");
		expect(
			await upgradeLegacyPasswordHash(adapter, {
				userId: "u1",
				password: "Procomun-2026!",
			}),
		).toBeFalse();
		expect(updates).toHaveLength(0);
	});
});

describe("replaceLegacyPasswordHash sobre PGlite", () => {
	let pglite: PGlite;
	let db: ReturnType<typeof drizzle<typeof schema>>;

	beforeAll(async () => {
		pglite = new PGlite();
		db = drizzle(pglite, { schema });
		await createTables(pglite);
		const now = new Date();
		await db.insert(schema.user).values({
			id: "u1",
			email: "u1@example.test",
			emailVerified: false,
			name: "U1",
			createdAt: now,
			updatedAt: now,
		});
	});

	afterAll(async () => {
		await pglite.close();
	});

	async function seedCredential(id: string, password: string) {
		const now = new Date();
		await db.insert(schema.account).values({
			id,
			userId: "u1",
			accountId: "u1",
			providerId: id.startsWith("oidc") ? "oidc" : "credential",
			password,
			createdAt: now,
			updatedAt: now,
		});
	}

	async function stored(id: string) {
		const rows = await db
			.select({ password: schema.account.password })
			.from(schema.account)
			.where(eq(schema.account.id, id));
		return rows[0]?.password;
	}

	test("escribe el hash nuevo si el almacenado es el esperado", async () => {
		await seedCredential("c1", BCRYPT_2Y);
		expect(
			await replaceLegacyPasswordHash(db, {
				credentialId: "c1",
				expectedHash: BCRYPT_2Y,
				newHash: "nuevo",
			}),
		).toBeTrue();
		expect(await stored("c1")).toBe("nuevo");
	});

	test("no escribe si el hash ha cambiado desde la lectura", async () => {
		await seedCredential("c2", "restablecido");
		expect(
			await replaceLegacyPasswordHash(db, {
				credentialId: "c2",
				expectedHash: BCRYPT_2Y,
				newHash: "nuevo",
			}),
		).toBeFalse();
		expect(await stored("c2")).toBe("restablecido");
	});

	test("no escribe en una cuenta que no es de credenciales", async () => {
		await seedCredential("oidc-c3", BCRYPT_2Y);
		expect(
			await replaceLegacyPasswordHash(db, {
				credentialId: "oidc-c3",
				expectedHash: BCRYPT_2Y,
				newHash: "nuevo",
			}),
		).toBeFalse();
		expect(await stored("oidc-c3")).toBe(BCRYPT_2Y);
	});
});
