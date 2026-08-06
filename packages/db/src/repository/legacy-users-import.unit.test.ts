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
});
