import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { mapLegacyUser } from "../legacy-import/users.ts";
import * as schema from "../schema/index.ts";
import { createTables } from "../setup.ts";
import { importLegacyUser } from "./legacy-users-import.ts";
import type { DrizzleDB } from "./shared.ts";

describe("importLegacyUser", () => {
	let pglite: PGlite;
	let db: DrizzleDB;

	beforeEach(async () => {
		pglite = new PGlite();
		await createTables(pglite);
		db = drizzle(pglite, { schema });
	});

	afterEach(async () => {
		await pglite.close();
	});

	const DRUPAL7 = "$S$E6rSBHqMIJwP/yOyG9ctZ0MoaC6ml0ahKsvSQ0lbnRLYBOYSB2Qv";

	function fullLegacy(overrides: Record<string, unknown> = {}) {
		return mapLegacyUser({
			uid: 1,
			name: "legacy@example.test",
			pass: DRUPAL7,
			mail: "legacy@example.test",
			roles: "publicador_certificado",
			status: 1,
			field_name_value: "Usuaria",
			field_surname_value: "Legacy",
			field_country_country_code: "ES",
			field_country_locality: "Burgos",
			field_educative_center_value: "CEIP Ejemplo",
			field_sobre_mi_value: "Sobre mí",
			field_website_value: "https://legacy.example",
			...overrides,
		});
	}

	async function credentialAccounts(userId: string) {
		return (await db.select().from(schema.account)).filter(
			(row) => row.userId === userId && row.providerId === "credential",
		);
	}

	test("crea la cuenta con nombre, rol, hash antiguo y perfil; la segunda ejecución se omite", async () => {
		const mapped = fullLegacy();

		expect(await importLegacyUser(db, mapped)).toEqual({
			outcome: "imported",
			id: "legacy-procomun:user:1",
		});
		expect(await importLegacyUser(db, mapped)).toEqual({
			outcome: "skipped_existing_id",
			id: "legacy-procomun:user:1",
		});

		const [row] = await db.select().from(schema.user);
		expect(row).toMatchObject({
			id: "legacy-procomun:user:1",
			email: "legacy@example.test",
			name: "Usuaria Legacy",
			role: "editor",
			isActive: true,
			banned: false,
		});

		const accounts = await credentialAccounts("legacy-procomun:user:1");
		expect(accounts).toHaveLength(1);
		expect(accounts[0]).toMatchObject({
			id: "legacy-procomun:account:1",
			accountId: "legacy-procomun:user:1",
			password: DRUPAL7,
		});

		const profiles = await db.select().from(schema.userProfile);
		expect(profiles).toHaveLength(1);
		expect(profiles[0]).toMatchObject({
			userId: "legacy-procomun:user:1",
			countryCode: "ES",
			locality: "Burgos",
			educationalCenter: "CEIP Ejemplo",
			about: "Sobre mí",
			website: "https://legacy.example/",
		});
	});

	test("status 0 entra bloqueado, con su contraseña y su perfil", async () => {
		expect(await importLegacyUser(db, fullLegacy({ status: 0 }))).toEqual({
			outcome: "imported",
			id: "legacy-procomun:user:1",
		});

		const [row] = await db.select().from(schema.user);
		expect(row?.isActive).toBeFalse();
		expect(row?.banned).toBeTrue();
		expect(row?.banExpires).toBeNull();
		expect(row?.banReason).toContain("Procomún anterior");
		expect(await credentialAccounts("legacy-procomun:user:1")).toHaveLength(1);
		expect(await db.select().from(schema.userProfile)).toHaveLength(1);
	});

	test("reimportar no cambia el estado: lo decide la administración", async () => {
		await importLegacyUser(db, fullLegacy({ status: 0 }));
		await importLegacyUser(db, fullLegacy({ status: 1 }));
		const [blocked] = await db.select().from(schema.user);
		expect(blocked?.isActive).toBeFalse();
		expect(blocked?.banned).toBeTrue();

		await db
			.update(schema.user)
			.set({ isActive: true, banned: false, banReason: null });
		await importLegacyUser(db, fullLegacy({ status: 0 }));
		const [unblocked] = await db.select().from(schema.user);
		expect(unblocked?.isActive).toBeTrue();
		expect(unblocked?.banned).toBeFalse();
	});

	test("sin hash admitido no crea cuenta de credenciales", async () => {
		await importLegacyUser(db, fullLegacy({ pass: null }));
		expect(await credentialAccounts("legacy-procomun:user:1")).toHaveLength(0);
	});

	test("al reimportar no pisa cambios hechos después en la cuenta, la contraseña ni el perfil", async () => {
		await importLegacyUser(db, fullLegacy());
		await db
			.update(schema.user)
			.set({ name: "Nombre editado", role: "curator", isActive: false });
		await db.update(schema.account).set({ password: "salt:nuevo-hash" });
		await db.update(schema.userProfile).set({ locality: "Valladolid" });

		const again = fullLegacy({
			field_name_value: "Otro",
			status: 1,
			roles: "administrator",
			field_country_locality: "León",
		});
		expect(await importLegacyUser(db, again)).toEqual({
			outcome: "skipped_existing_id",
			id: "legacy-procomun:user:1",
		});

		const [row] = await db.select().from(schema.user);
		expect(row).toMatchObject({
			name: "Nombre editado",
			role: "curator",
			isActive: false,
		});
		const accounts = await credentialAccounts("legacy-procomun:user:1");
		expect(accounts.map((account) => account.password)).toEqual([
			"salt:nuevo-hash",
		]);
		const [profile] = await db.select().from(schema.userProfile);
		expect(profile?.locality).toBe("Valladolid");
	});

	test("completa perfil y contraseña de usuarios importados con la versión anterior del importador", async () => {
		// La versión de #309 creaba solo la cuenta, sin credenciales ni perfil.
		await db.insert(schema.user).values({
			id: "legacy-procomun:user:1",
			email: "legacy@example.test",
			name: "legacy@example.test",
			role: "editor",
			isActive: true,
		});

		expect(await importLegacyUser(db, fullLegacy())).toEqual({
			outcome: "skipped_existing_id",
			id: "legacy-procomun:user:1",
			completed: ["password", "profile"],
		});
		expect(await credentialAccounts("legacy-procomun:user:1")).toHaveLength(1);
		expect(await db.select().from(schema.userProfile)).toHaveLength(1);
	});

	test("no añade el hash antiguo si la persona ya tiene otra contraseña", async () => {
		await db.insert(schema.user).values({
			id: "legacy-procomun:user:1",
			email: "legacy@example.test",
			role: "author",
		});
		await db.insert(schema.account).values({
			id: "acc-reset",
			userId: "legacy-procomun:user:1",
			accountId: "legacy-procomun:user:1",
			providerId: "credential",
			password: "salt:recuperada",
		});

		const result = await importLegacyUser(db, fullLegacy());
		expect(result).toEqual({
			outcome: "skipped_existing_id",
			id: "legacy-procomun:user:1",
			completed: ["profile"],
		});
		const accounts = await credentialAccounts("legacy-procomun:user:1");
		expect(accounts.map((account) => account.password)).toEqual([
			"salt:recuperada",
		]);
	});

	test("no reemplaza una cuenta existente que comparte email", async () => {
		const existing = mapLegacyUser({
			uid: 1,
			mail: "same@example.test",
			status: 1,
		});
		await importLegacyUser(db, existing);

		const colliding = mapLegacyUser({
			uid: 2,
			mail: "same@example.test",
			status: 1,
		});
		expect(await importLegacyUser(db, colliding)).toEqual({
			outcome: "skipped_existing_email",
			id: "legacy-procomun:user:1",
		});
	});

	test("trata los correos como únicos sin distinguir mayúsculas", async () => {
		await db.insert(schema.user).values({
			id: "existing-user",
			email: "Admin@example.test",
			emailVerified: true,
			role: "author",
			isActive: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		const colliding = mapLegacyUser({
			uid: 2,
			mail: "admin@example.test",
			status: 1,
		});
		expect(await importLegacyUser(db, colliding)).toEqual({
			outcome: "skipped_existing_email",
			id: "existing-user",
		});
		await expect(
			(async () => {
				await db.insert(schema.user).values({
					id: "duplicate-user",
					email: "admin@example.test",
					emailVerified: true,
					role: "author",
					isActive: true,
					createdAt: new Date(),
					updatedAt: new Date(),
				});
			})(),
		).rejects.toThrow();
	});

	test("informa un conflicto cuando dos importaciones concurren", async () => {
		const mapped = mapLegacyUser({
			uid: 9,
			mail: "concurrent@example.test",
			status: 1,
		});

		const outcomes = await Promise.all([
			importLegacyUser(db, mapped),
			importLegacyUser(db, mapped),
		]);
		expect(
			outcomes.filter((result) => result.outcome === "imported"),
		).toHaveLength(1);
		expect(
			outcomes.filter((result) => result.outcome === "skipped_existing_id"),
		).toHaveLength(1);
	});
});
