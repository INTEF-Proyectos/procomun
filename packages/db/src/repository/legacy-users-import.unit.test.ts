import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { mapLegacyUser } from "../legacy-import/users.ts";
import * as schema from "../schema/index.ts";
import { createTables } from "../setup.ts";
import { fixLegacyUserRole, importLegacyUser } from "./legacy-users-import.ts";
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

	// Revisión de #586: la 0023 crea una fila con solo la bio para una cuenta
	// legacy sin perfil; reimportar completa lo vacío y conserva lo demás.
	test("completa país y localidad de un perfil creado por la 0023 y conserva la bio", async () => {
		const { readFile } = await import("node:fs/promises");
		await pglite.exec(
			'ALTER TABLE "user" ADD COLUMN bio TEXT; ALTER TABLE "user_profile" DROP COLUMN about_edited_at;',
		);
		await db.insert(schema.user).values({
			id: "legacy-procomun:user:1",
			email: "legacy@example.test",
			role: "editor",
		});
		await pglite.exec(
			`UPDATE "user" SET bio = 'Bio escrita en la nueva' WHERE id = 'legacy-procomun:user:1'`,
		);
		await pglite.exec(
			await readFile(
				new URL(
					"../../migrations/0023_user_bio_to_profile.sql",
					import.meta.url,
				),
				"utf8",
			),
		);

		expect(await importLegacyUser(db, fullLegacy())).toMatchObject({
			outcome: "skipped_existing_id",
			completed: ["password", "profile"],
		});
		const [profile] = await db.select().from(schema.userProfile);
		expect(profile).toMatchObject({
			about: "Bio escrita en la nueva",
			countryCode: "ES",
			locality: "Burgos",
			educationalCenter: "CEIP Ejemplo",
		});
		expect(profile?.aboutEditedAt).not.toBeNull();
		// Segunda pasada: nada que completar.
		expect(await importLegacyUser(db, fullLegacy())).toEqual({
			outcome: "skipped_existing_id",
			id: "legacy-procomun:user:1",
		});
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

describe("fixLegacyUserRole (#507)", () => {
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
	const LEGACY_ID = "legacy-procomun:user:1";
	const IMPORTED_AT = new Date("2026-10-28T10:00:00Z");

	function legacy(overrides: Record<string, unknown> = {}) {
		return mapLegacyUser({
			uid: 1,
			pass: DRUPAL7,
			mail: "legacy@example.test",
			roles: "-",
			status: 1,
			field_name_value: "Usuaria",
			field_surname_value: "Legacy",
			field_country_locality: "Burgos",
			...overrides,
		});
	}

	/** Lo que dejó #488 antes de #507: una cuenta legacy como `author`. */
	async function importedAs(
		role: string,
		overrides: Record<string, unknown> = {},
	) {
		const mapped = legacy(overrides);
		await importLegacyUser(db, mapped);
		await db
			.update(schema.user)
			.set({ role, updatedAt: IMPORTED_AT })
			.where(eq(schema.user.id, mapped.id));
		return mapped;
	}

	async function userRow(id = LEGACY_ID) {
		const [row] = await db
			.select()
			.from(schema.user)
			.where(eq(schema.user.id, id));
		return row;
	}

	test("pasa a editor una cuenta legacy importada como author", async () => {
		const mapped = await importedAs("author");

		expect(await fixLegacyUserRole(db, mapped)).toEqual({
			outcome: "fixed",
			id: LEGACY_ID,
			from: "author",
			to: "editor",
		});
		const row = await userRow();
		expect(row?.role).toBe("editor");
		expect(row?.updatedAt.getTime()).toBeGreaterThan(IMPORTED_AT.getTime());
	});

	test("es repetible: la segunda pasada no cambia nada ni duplica", async () => {
		const mapped = await importedAs("author");
		await fixLegacyUserRole(db, mapped);
		const afterFirst = await userRow();

		expect(await fixLegacyUserRole(db, mapped)).toEqual({
			outcome: "unchanged",
			id: LEGACY_ID,
			role: "editor",
		});
		expect(await userRow()).toEqual(afterFirst);
		expect(await db.select().from(schema.user)).toHaveLength(1);
		expect(await db.select().from(schema.account)).toHaveLength(1);
		expect(await db.select().from(schema.userProfile)).toHaveLength(1);
	});

	test("en dry-run informa el cambio sin escribir", async () => {
		const mapped = await importedAs("author");
		expect(await fixLegacyUserRole(db, mapped, { dryRun: true })).toEqual({
			outcome: "fixed",
			id: LEGACY_ID,
			from: "author",
			to: "editor",
		});
		const row = await userRow();
		expect(row?.role).toBe("author");
		expect(row?.updatedAt.getTime()).toBe(IMPORTED_AT.getTime());
	});

	test("conserva el bloqueo, las credenciales, el ID, el perfil y los recursos", async () => {
		const mapped = await importedAs("author", { status: 0 });
		await db.insert(schema.resources).values({
			id: "res-legacy",
			slug: "recurso-legacy",
			title: "Recurso",
			description: "Desc",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			createdBy: LEGACY_ID,
		});
		const before = await userRow();
		const accountsBefore = await db.select().from(schema.account);
		const profilesBefore = await db.select().from(schema.userProfile);

		await fixLegacyUserRole(db, mapped);

		const after = await userRow();
		expect(after).toEqual({
			...before,
			role: "editor",
			updatedAt: after?.updatedAt,
		} as typeof after);
		expect(after?.isActive).toBeFalse();
		expect(after?.banned).toBeTrue();
		expect(after?.banReason).toContain("Procomún anterior");
		expect(await db.select().from(schema.account)).toEqual(accountsBefore);
		expect(await db.select().from(schema.userProfile)).toEqual(profilesBefore);
		const [resource] = await db.select().from(schema.resources);
		expect(resource?.createdBy).toBe(LEGACY_ID);
	});

	test("no toca cuentas legacy admin ni curator, ni otros roles puestos a mano", async () => {
		for (const role of ["admin", "curator", "reader"]) {
			const mapped = await importedAs(role);
			expect(await fixLegacyUserRole(db, mapped)).toEqual({
				outcome: "kept",
				id: LEGACY_ID,
				role,
			});
			const row = await userRow();
			expect(row?.role).toBe(role);
			expect(row?.updatedAt.getTime()).toBe(IMPORTED_AT.getTime());
		}
	});

	test("un admin del origen que hoy es author no pasa a editor ni a admin", async () => {
		const mapped = await importedAs("author", { roles: "administrator" });
		expect(mapped.role).toBe("admin");
		expect(await fixLegacyUserRole(db, mapped)).toEqual({
			outcome: "kept",
			id: LEGACY_ID,
			role: "author",
		});
		expect((await userRow())?.role).toBe("author");
	});

	test("un admin legacy importado como admin sigue igual", async () => {
		const mapped = await importedAs("admin", { roles: "administrator" });
		expect(await fixLegacyUserRole(db, mapped)).toEqual({
			outcome: "unchanged",
			id: LEGACY_ID,
			role: "admin",
		});
	});

	test("no sube a admin un `administrador` que #309 cargó como editor", async () => {
		const mapped = await importedAs("editor", { roles: "administrador" });
		expect(await fixLegacyUserRole(db, mapped)).toEqual({
			outcome: "kept",
			id: LEGACY_ID,
			role: "editor",
		});
		const row = await userRow();
		expect(row?.role).toBe("editor");
		expect(row?.updatedAt.getTime()).toBe(IMPORTED_AT.getTime());
	});

	test("no toca cuentas ajenas a la migración, aunque compartan correo", async () => {
		await db.insert(schema.user).values({
			id: "native-user",
			email: "legacy@example.test",
			role: "author",
			updatedAt: IMPORTED_AT,
		});

		expect(await fixLegacyUserRole(db, legacy())).toEqual({
			outcome: "not_found",
			id: LEGACY_ID,
		});
		// Aunque se le pase un ID nativo, solo corrige IDs legacy.
		expect(
			await fixLegacyUserRole(db, { ...legacy(), id: "native-user" }),
		).toEqual({ outcome: "not_found", id: "native-user" });
		const native = await userRow("native-user");
		expect(native?.role).toBe("author");
		expect(native?.updatedAt.getTime()).toBe(IMPORTED_AT.getTime());
	});
});
