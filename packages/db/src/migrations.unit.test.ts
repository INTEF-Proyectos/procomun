import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const migrationsDir = path.resolve(import.meta.dir, "../migrations");

describe("migración de unicidad de email", () => {
	test("registra la migración 0006 y bloquea duplicados por mayúsculas antes de crear el índice", async () => {
		const journal = JSON.parse(
			await readFile(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
		) as { entries: Array<{ tag: string }> };
		expect(journal.entries.map((entry) => entry.tag)).toContain(
			"0006_user_email_case_insensitive",
		);

		const migration = await readFile(
			path.join(migrationsDir, "0006_user_email_case_insensitive.sql"),
			"utf8",
		);
		expect(migration).toContain("GROUP BY lower(email)");
		expect(migration).toContain("HAVING count(*) > 1");
		expect(migration).toContain(
			"CREATE UNIQUE INDEX IF NOT EXISTS user_email_lower_unique",
		);
		expect(await readdir(migrationsDir)).not.toContain(
			"0005_user_email_case_insensitive.sql",
		);
	});

	test("detiene la migración ante duplicados históricos y crea el índice cuando no los hay", async () => {
		const migration = (
			await readFile(
				path.join(migrationsDir, "0006_user_email_case_insensitive.sql"),
				"utf8",
			)
		).replace("--> statement-breakpoint", "");
		const conflictingDb = new PGlite();
		const cleanDb = new PGlite();

		try {
			await conflictingDb.exec(
				'CREATE TABLE "user" (email varchar(255) NOT NULL)',
			);
			await conflictingDb.exec(
				"INSERT INTO \"user\" (email) VALUES ('Admin@example.test'), ('admin@example.test')",
			);
			await expect(conflictingDb.exec(migration)).rejects.toThrow(
				"No se puede crear user_email_lower_unique",
			);

			await cleanDb.exec('CREATE TABLE "user" (email varchar(255) NOT NULL)');
			await expect(cleanDb.exec(migration)).resolves.toBeDefined();
			await expect(
				cleanDb.exec(
					"INSERT INTO \"user\" (email) VALUES ('Admin@example.test'), ('admin@example.test')",
				),
			).rejects.toThrow();
		} finally {
			await Promise.all([conflictingDb.close(), cleanDb.close()]);
		}
	});
});

// 2026-09-15: better-auth 1.7 exige session.impersonatedBy (plugin admin) y
// lanza SchemaMismatchError en el sign-in si el esquema Drizzle no la tiene.
describe("migración session.impersonated_by (better-auth 1.7)", () => {
	const OLD_SESSION_TABLE = `CREATE TABLE "session" (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL,
		expires_at TIMESTAMP NOT NULL,
		token TEXT NOT NULL UNIQUE
	)`;
	const COLUMN_QUERY = `SELECT column_name FROM information_schema.columns
		WHERE table_name = 'session' AND column_name = 'impersonated_by'`;

	test("registra la migración 0008 y añade la columna a una tabla session previa", async () => {
		const journal = JSON.parse(
			await readFile(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
		) as { entries: Array<{ tag: string }> };
		expect(journal.entries.map((entry) => entry.tag)).toContain(
			"0008_session_impersonated_by",
		);

		const migration = (
			await readFile(
				path.join(migrationsDir, "0008_session_impersonated_by.sql"),
				"utf8",
			)
		).replace("--> statement-breakpoint", "");
		const db = new PGlite();
		try {
			await db.exec(OLD_SESSION_TABLE);
			await db.exec(migration);
			await db.exec(migration); // idempotente
			expect((await db.query(COLUMN_QUERY)).rows).toHaveLength(1);
		} finally {
			await db.close();
		}
	});

	test("createTables añade la columna tanto en BD nueva como en PGlite ya existente", async () => {
		const { createTables } = await import("./setup.ts");
		const fresh = new PGlite();
		const existing = new PGlite();
		try {
			await createTables(fresh);
			expect((await fresh.query(COLUMN_QUERY)).rows).toHaveLength(1);

			await existing.exec(OLD_SESSION_TABLE);
			await createTables(existing);
			expect((await existing.query(COLUMN_QUERY)).rows).toHaveLength(1);
		} finally {
			await Promise.all([fresh.close(), existing.close()]);
		}
	});
});

describe("migración de categorización educativa", () => {
	test("registra 0009 sin sustituir 0000–0008 y crea la tabla con unicidad", async () => {
		const journal = JSON.parse(
			await readFile(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
		) as { entries: Array<{ tag: string }> };
		const tags = journal.entries.map((entry) => entry.tag);
		expect(tags).toContain("0009_educational_areas");
		for (const previous of [
			"0000_slippery_mongoose",
			"0001_needy_stellaris",
			"0005_atomized_tags",
			"0006_user_email_case_insensitive",
			"0007_resource_versions",
			"0008_session_impersonated_by",
		]) {
			expect(tags).toContain(previous);
		}
		const files = await readdir(migrationsDir);
		expect(files).toContain("0008_session_impersonated_by.sql");
		expect(files).toContain("0009_educational_areas.sql");

		const migration = (
			await readFile(
				path.join(migrationsDir, "0009_educational_areas.sql"),
				"utf8",
			)
		).replaceAll("--> statement-breakpoint", "");
		const db = new PGlite();
		try {
			await db.exec('CREATE TABLE "resources" (id text PRIMARY KEY)');
			await db.exec(`INSERT INTO "resources" (id) VALUES ('r1')`);
			await db.exec(migration);
			await db.exec(migration);
			await db.exec(
				`INSERT INTO resource_educational_areas (resource_id, category_id, option_id)
				 VALUES ('r1', 'bachillerato', NULL)`,
			);
			await expect(
				db.exec(
					`INSERT INTO resource_educational_areas (resource_id, category_id, option_id)
					 VALUES ('r1', 'bachillerato', NULL)`,
				),
			).rejects.toThrow();
		} finally {
			await db.close();
		}
	});
});
