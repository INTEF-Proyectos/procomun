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

	test("crea una cuenta sin credenciales y la segunda ejecución se omite", async () => {
		const mapped = mapLegacyUser({
			uid: 1,
			name: "Usuaria legacy",
			mail: "legacy@example.test",
			roles: "-",
			status: 1,
		});

		expect(await importLegacyUser(db, mapped)).toEqual({
			outcome: "imported",
			id: "legacy-procomun:user:1",
		});
		expect(await importLegacyUser(db, mapped)).toEqual({
			outcome: "skipped_existing_id",
			id: "legacy-procomun:user:1",
		});
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
