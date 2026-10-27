import { describe, expect, test } from "bun:test";
import { hashPassword } from "better-auth/crypto";
import {
	isLegacyPasswordHash,
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
	function fakeAdapter(password: string | null, providerId = "credential") {
		const updates: Array<{ userId: string; hash: string }> = [];
		return {
			updates,
			adapter: {
				findAccounts: async (userId: string) => [
					{ userId, accountId: userId, providerId, password },
				],
				updatePassword: async (userId: string, hash: string) => {
					updates.push({ userId, hash });
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
