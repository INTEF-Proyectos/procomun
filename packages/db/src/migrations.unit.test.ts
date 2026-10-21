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

// El migrador de drizzle solo aplica migraciones con `when` mayor que el de la
// última aplicada: si dos ramas registran el mismo número o el mismo `when`,
// una de ellas se salta en silencio en las bases que ya tengan la otra.
describe("journal de migraciones", () => {
	// Historial previo a esta regla. Ya está aplicado, así que no se reescribe.
	const LEGACY_WHEN_OUT_OF_ORDER = new Set(["0002_text_to_jsonb_metadata"]);
	const LEGACY_FILES_OUTSIDE_JOURNAL = new Set([
		"0002_add_downloads_format.sql",
		"0003_add_reports_table.sql",
		"0004_resources_import_dedup_index.sql",
	]);

	test("idx igual a la posición, when creciente y un fichero por número", async () => {
		const journal = JSON.parse(
			await readFile(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
		) as { entries: Array<{ idx: number; when: number; tag: string }> };

		let lastWhen = 0;
		journal.entries.forEach((entry, position) => {
			expect(entry.idx).toBe(position);
			if (LEGACY_WHEN_OUT_OF_ORDER.has(entry.tag)) return;
			expect(entry.when).toBeGreaterThan(lastWhen);
			lastWhen = entry.when;
		});

		const prefixes = journal.entries.map((entry) => entry.tag.slice(0, 4));
		expect(prefixes).toEqual([...new Set(prefixes)].sort());

		const files = (await readdir(migrationsDir))
			.filter((file) => file.endsWith(".sql"))
			.filter((file) => !LEGACY_FILES_OUTSIDE_JOURNAL.has(file));
		expect(files.sort()).toEqual(
			journal.entries.map((entry) => `${entry.tag}.sql`).sort(),
		);
		const filePrefixes = files.map((file) => file.slice(0, 4));
		expect(new Set(filePrefixes).size).toBe(filePrefixes.length);
	});
});

// ADR-0042: catálogo de palabras clave. Va detrás de 0009 (#394) en el journal.
describe("migración 0010_keyword_catalog", () => {
	const OLD_SCHEMA = `CREATE TABLE "user" (id TEXT PRIMARY KEY);
		CREATE TABLE "tags" (
			id TEXT PRIMARY KEY,
			slug VARCHAR(255) NOT NULL UNIQUE,
			label TEXT NOT NULL,
			description TEXT,
			usage_count INTEGER NOT NULL DEFAULT 0,
			canonical_tag_id TEXT,
			created_at TIMESTAMP NOT NULL DEFAULT NOW(),
			updated_at TIMESTAMP NOT NULL DEFAULT NOW()
		);
		INSERT INTO tags (id, slug, label) VALUES ('libre-1', 'matematicas', 'matemáticas');`;

	test("va después de todas las anteriores en el journal", async () => {
		const journal = JSON.parse(
			await readFile(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
		) as { entries: Array<{ idx: number; tag: string; when: number }> };
		const entry = journal.entries.find(
			(item) => item.tag === "0010_keyword_catalog",
		);
		expect(entry?.idx).toBe(8);
		const others = journal.entries.filter((item) => item !== entry);
		expect(Math.max(...others.map((item) => item.when))).toBeLessThan(
			entry?.when ?? 0,
		);
		// 0009_educational_areas (#394) usa when 1786600000000.
		expect(entry?.when ?? 0).toBeGreaterThan(1786600000000);
	});

	test("siembra el catálogo una vez sin renombrar etiquetas existentes", async () => {
		const migration = (
			await readFile(
				path.join(migrationsDir, "0010_keyword_catalog.sql"),
				"utf8",
			)
		).replaceAll("--> statement-breakpoint", "");
		const { KEYWORD_CATALOG_SEED } = await import("./setup.ts");
		expect(migration).toContain(KEYWORD_CATALOG_SEED);

		const db = new PGlite();
		try {
			await db.exec(OLD_SCHEMA);
			await db.exec(migration);
			await db.exec(migration); // idempotente
			const rows = await db.query<{
				id: string;
				slug: string;
				catalog: boolean;
			}>(
				"SELECT id, slug, catalog FROM tags WHERE label ILIKE 'matem%' ORDER BY id",
			);
			expect(rows.rows).toEqual([
				{ id: "libre-1", slug: "matematicas", catalog: false },
				{ id: "matematicas", slug: "matematicas-catalogo", catalog: true },
			]);
			const count = await db.query<{ n: number }>(
				"SELECT count(*)::int AS n FROM tags WHERE catalog",
			);
			expect(count.rows[0]?.n).toBe(50);
			await expect(
				db.exec(
					"INSERT INTO tags (id, slug, label, catalog) VALUES ('x', 'x', 'GEOMETRIA', true)",
				),
			).rejects.toThrow();
		} finally {
			await db.close();
		}
	});
});
