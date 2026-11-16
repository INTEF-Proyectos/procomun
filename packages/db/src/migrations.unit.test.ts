import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { SCHEMA_STATEMENTS } from "./setup.ts";

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

describe("migración resources.thumbnail_url (issue #407)", () => {
	const COLUMN_QUERY = `SELECT column_name FROM information_schema.columns
		WHERE table_name = 'resources' AND column_name = 'thumbnail_url'`;

	test("registra la migración 0010 y añade la columna a una tabla resources previa", async () => {
		const journal = JSON.parse(
			await readFile(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
		) as { entries: Array<{ tag: string }> };
		expect(journal.entries.map((entry) => entry.tag)).toContain(
			"0010_resource_thumbnail_url",
		);

		const migration = await readFile(
			path.join(migrationsDir, "0010_resource_thumbnail_url.sql"),
			"utf8",
		);
		const db = new PGlite();
		try {
			await db.exec(
				'CREATE TABLE "resources" (id TEXT PRIMARY KEY, title TEXT NOT NULL)',
			);
			await db.exec(migration);
			await db.exec(migration);
			expect((await db.query(COLUMN_QUERY)).rows).toHaveLength(1);
		} finally {
			await db.close();
		}
	});
});

describe("migración resources.other_authors (issue #417)", () => {
	const COLUMN_QUERY = `SELECT column_name FROM information_schema.columns
		WHERE table_name = 'resources' AND column_name = 'other_authors'`;

	test("registra la migración 0012 y añade la columna a una tabla resources previa", async () => {
		const journal = JSON.parse(
			await readFile(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
		) as { entries: Array<{ tag: string }> };
		expect(journal.entries.map((entry) => entry.tag)).toContain(
			"0012_resource_other_authors",
		);

		const migration = await readFile(
			path.join(migrationsDir, "0012_resource_other_authors.sql"),
			"utf8",
		);
		const db = new PGlite();
		try {
			await db.exec(
				'CREATE TABLE "resources" (id TEXT PRIMARY KEY, title TEXT NOT NULL)',
			);
			await db.exec(migration);
			await db.exec(migration);
			expect((await db.query(COLUMN_QUERY)).rows).toHaveLength(1);
		} finally {
			await db.close();
		}
	});

	test("createTables añade la columna tanto en BD nueva como en una ya existente", async () => {
		const { createTables } = await import("./setup.ts");
		const fresh = new PGlite();
		const existing = new PGlite();
		try {
			await createTables(fresh);
			expect((await fresh.query(COLUMN_QUERY)).rows).toHaveLength(1);

			await createTables(existing);
			await existing.exec('ALTER TABLE "resources" DROP COLUMN other_authors');
			await createTables(existing);
			expect((await existing.query(COLUMN_QUERY)).rows).toHaveLength(1);
		} finally {
			await Promise.all([fresh.close(), existing.close()]);
		}
	});
});

describe("migración elpx_projects.has_screenshot (issue #409)", () => {
	const COLUMN_QUERY = `SELECT column_name FROM information_schema.columns
		WHERE table_name = 'elpx_projects' AND column_name = 'has_screenshot'`;

	test("registra 0015 y añade la columna con false a los proyectos previos", async () => {
		const journal = JSON.parse(
			await readFile(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
		) as { entries: Array<{ tag: string }> };
		expect(journal.entries.map((entry) => entry.tag)).toContain(
			"0018_elpx_has_screenshot",
		);

		const migration = await readFile(
			path.join(migrationsDir, "0018_elpx_has_screenshot.sql"),
			"utf8",
		);
		const db = new PGlite();
		try {
			await db.exec(
				`CREATE TABLE "elpx_projects" (id TEXT PRIMARY KEY, has_preview BOOLEAN NOT NULL DEFAULT false);
				INSERT INTO elpx_projects (id) VALUES ('previo');`,
			);
			await db.exec(migration);
			await db.exec(migration);
			expect((await db.query(COLUMN_QUERY)).rows).toHaveLength(1);
			const rows = await db.query<{ has_screenshot: boolean }>(
				"SELECT has_screenshot FROM elpx_projects",
			);
			expect(rows.rows).toEqual([{ has_screenshot: false }]);
		} finally {
			await db.close();
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

// ADR-0042: catálogo de palabras clave. Va detrás de 0010 (#425) en el journal.
describe("migración 0011_keyword_catalog", () => {
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
			(item) => item.tag === "0011_keyword_catalog",
		);
		expect(entry?.idx).toBe(9);
		// Solo las anteriores: 0012_resource_other_authors (#417) va detrás.
		const others = journal.entries.filter((item) => item.idx < 9);
		expect(Math.max(...others.map((item) => item.when))).toBeLessThan(
			entry?.when ?? 0,
		);
		// 0010_resource_thumbnail_url (#425) usa when 1792080000000.
		expect(entry?.when ?? 0).toBeGreaterThan(1792080000000);
	});

	test("siembra el catálogo una vez sin renombrar etiquetas existentes", async () => {
		const migration = (
			await readFile(
				path.join(migrationsDir, "0011_keyword_catalog.sql"),
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

// ADR-0045: áreas de conocimiento y familias profesionales (#448).
describe("migración 0014_knowledge_areas", () => {
	const OLD_SCHEMA = `CREATE TABLE "user" (id TEXT PRIMARY KEY);
		CREATE TABLE "resources" (id TEXT PRIMARY KEY);
		CREATE TABLE "tags" (id TEXT PRIMARY KEY, label TEXT NOT NULL);
		INSERT INTO "resources" (id) VALUES ('r1');`;

	test("va después de todas las anteriores en el journal", async () => {
		const journal = JSON.parse(
			await readFile(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
		) as { entries: Array<{ tag: string; when: number }> };
		const entry = journal.entries.find(
			(item) => item.tag === "0014_knowledge_areas",
		);
		expect(entry).toBeDefined();
		// Las posteriores, como 0015, no forman parte de las anteriores a 0014.
		const others = journal.entries.filter(
			(item) => item.tag < "0014_knowledge_areas",
		);
		expect(Math.max(...others.map((item) => item.when))).toBeLessThan(
			entry?.when ?? 0,
		);
	});

	test("crea el catálogo una vez y coincide con setup.ts", async () => {
		const migration = (
			await readFile(
				path.join(migrationsDir, "0014_knowledge_areas.sql"),
				"utf8",
			)
		).replaceAll("--> statement-breakpoint", "");
		const { KNOWLEDGE_AREA_SEED_SQL, KNOWLEDGE_AREA_SEED } = await import(
			"./knowledge-areas.ts"
		);
		const { SCHEMA_STATEMENTS } = await import("./setup.ts");
		expect(migration).toContain(KNOWLEDGE_AREA_SEED_SQL);
		expect(SCHEMA_STATEMENTS).toContain(KNOWLEDGE_AREA_SEED_SQL);

		const db = new PGlite();
		try {
			await db.exec(OLD_SCHEMA);
			await db.exec(migration);
			await db.exec(migration); // idempotente
			const count = await db.query<{ n: number }>(
				"SELECT count(*)::int AS n FROM knowledge_areas",
			);
			expect(count.rows[0]?.n).toBe(KNOWLEDGE_AREA_SEED.length);
			await db.exec(
				"INSERT INTO resource_knowledge_areas (resource_id, area_id) VALUES ('r1', 'quimica')",
			);
			await db.exec(
				"INSERT INTO resource_professional_families (resource_id, family_id) VALUES ('r1', 'sanidad')",
			);
			// Un área con recursos no se puede borrar: se desactiva.
			await expect(
				db.exec("DELETE FROM knowledge_areas WHERE id = 'quimica'"),
			).rejects.toThrow();
			await expect(
				db.exec(
					"INSERT INTO knowledge_areas (id, label, block_id) VALUES ('x', 'QUIMICA', 'ciencias')",
				),
			).rejects.toThrow();
			const retired = await db.query<{ column_name: string }>(
				"SELECT column_name FROM information_schema.columns WHERE table_name = 'tags' AND column_name = 'retired_at'",
			);
			expect(retired.rows).toHaveLength(1);
		} finally {
			await db.close();
		}
	});
});

// ADR-0044 (#421): contador de visitas. 0012 queda para #457.
describe("migración 0013_resource_views", () => {
	test("coincide con setup.ts y se puede aplicar dos veces", async () => {
		const migration = await readFile(
			path.join(migrationsDir, "0013_resource_views.sql"),
			"utf8",
		);
		const { RESOURCE_VIEWS_SCHEMA } = await import("./setup.ts");
		const statements = migration
			.replace(/^--[^\n]*\n/, "")
			.split("--> statement-breakpoint")
			.map((statement) => statement.trim().replace(/;$/, ""));
		expect(statements).toEqual(RESOURCE_VIEWS_SCHEMA);

		const db = new PGlite();
		try {
			await db.exec(`CREATE TABLE "resources" (id TEXT PRIMARY KEY);
				INSERT INTO resources (id) VALUES ('r1');`);
			const sql = migration.replaceAll("--> statement-breakpoint", "");
			await db.exec(sql);
			await db.exec(sql);
			await db.exec(
				"INSERT INTO resource_view_sessions (resource_id, session_hash) VALUES ('r1', 'h')",
			);
			await expect(
				db.exec(
					"INSERT INTO resource_view_sessions (resource_id, session_hash) VALUES ('r1', 'h')",
				),
			).rejects.toThrow();
			await db.exec("DELETE FROM resources WHERE id = 'r1'");
			const left = await db.query<{ n: number }>(
				"SELECT count(*)::int AS n FROM resource_view_sessions",
			);
			expect(left.rows[0]?.n).toBe(0);
		} finally {
			await db.close();
		}
	});
});

// Issue #473: un recurso sin idioma en origen se guarda sin idioma, no "es".
describe("migración 0016_resource_language_nullable", () => {
	const OLD_RESOURCES =
		'CREATE TABLE "resources" (id TEXT PRIMARY KEY, title TEXT NOT NULL, language VARCHAR(10) NOT NULL)';
	const NULL_LANGUAGE_INSERT = `INSERT INTO "resources" (id, title, language) VALUES ('r2', 'Sin idioma', NULL)`;

	test("está en el journal y quita el NOT NULL de resources.language", async () => {
		const journal = JSON.parse(
			await readFile(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
		) as { entries: Array<{ tag: string }> };
		expect(journal.entries.map((entry) => entry.tag)).toContain(
			"0016_resource_language_nullable",
		);

		const migration = await readFile(
			path.join(migrationsDir, "0016_resource_language_nullable.sql"),
			"utf8",
		);
		const db = new PGlite();
		try {
			await db.exec(OLD_RESOURCES);
			await expect(db.exec(NULL_LANGUAGE_INSERT)).rejects.toThrow();
			await db.exec(migration);
			await db.exec(migration);
			await db.exec(NULL_LANGUAGE_INSERT);
		} finally {
			await db.close();
		}
	});

	test("el esquema de arranque (setup.ts) también lo quita en una base previa", async () => {
		const db = new PGlite();
		try {
			await db.exec(OLD_RESOURCES);
			const dropNotNull = SCHEMA_STATEMENTS.find((statement) =>
				/ALTER COLUMN language DROP NOT NULL/i.test(statement),
			);
			expect(dropNotNull).toBeDefined();
			await db.exec(dropNotNull as string);
			await db.exec(NULL_LANGUAGE_INSERT);
		} finally {
			await db.close();
		}
	});
});

// Issue #456: perfil migrado del Procomún anterior. Era la 0017, pero la 0018
// de #471 llegó antes a main: pasa a 0019 para ir detrás con un `when` mayor.
describe("migración 0019_user_profile", () => {
	// Era la última hasta la 0022 de #432, que va detrás.
	test("va detrás de las 0012–0018 en el journal", async () => {
		const journal = JSON.parse(
			await readFile(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
		) as { entries: Array<{ tag: string; when: number }> };
		const entry = journal.entries.find(
			(item) => item.tag === "0019_user_profile",
		);
		expect(entry).toBeDefined();
		const previous = journal.entries.filter(
			(item) => item.tag < "0019_user_profile",
		);
		expect(entry?.when ?? 0).toBeGreaterThan(
			Math.max(...previous.map((item) => item.when)),
		);
		expect(entry?.when ?? 0).toBeGreaterThan(1793200000000);
	});

	test("es idempotente y el perfil se borra con el usuario", async () => {
		const migration = (
			await readFile(path.join(migrationsDir, "0019_user_profile.sql"), "utf8")
		).replaceAll("--> statement-breakpoint", "");
		const db = new PGlite();
		try {
			await db.exec('CREATE TABLE "user" (id text PRIMARY KEY)');
			await db.exec(migration);
			await db.exec(migration);
			await db.exec(`INSERT INTO "user" (id) VALUES ('u1')`);
			await db.exec(
				`INSERT INTO "user_profile" (user_id, country_code, locality) VALUES ('u1', 'ES', 'Burgos')`,
			);
			await db.exec(`DELETE FROM "user" WHERE id = 'u1'`);
			const rows = await db.query('SELECT * FROM "user_profile"');
			expect(rows.rows).toHaveLength(0);
		} finally {
			await db.close();
		}
	});
});

// Renumerada a 0018: la 0016 de #473 ya esta en main y #488 reclamo la 0017
// para user_profile, asi que esta va detras (AGENTS.md: renumera el ultimo).
describe("journal combinado de areas y miniaturas (#471)", () => {
	test("conserva 0014 y aplica la de miniaturas despues, con otro idx y when", async () => {
		const journal = JSON.parse(
			await readFile(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
		) as { entries: Array<{ idx: number; tag: string; when: number }> };
		const areas = journal.entries.find(
			(entry) => entry.tag === "0014_knowledge_areas",
		);
		const screenshots = journal.entries.find(
			(entry) => entry.tag === "0018_elpx_has_screenshot",
		);
		expect(areas).toBeDefined();
		expect(screenshots).toBeDefined();
		// Ya no es la inmediatamente siguiente a 0014: entre medias esta la 0016
		// de #473, que se mezclo antes. Lo que importa es que va despues, con su
		// propio idx y su propio when, y que 0014 se conserva.
		expect(screenshots?.idx ?? -1).toBeGreaterThan(areas?.idx ?? 0);
		expect(screenshots?.when ?? 0).toBeGreaterThan(areas?.when ?? 0);
		// Detras va la 0019_user_profile de #488, que se mezclo despues (y,
		// desde #432, la 0022 de las colecciones importadas).
		const tags = journal.entries.map((entry) => entry.tag);
		expect(tags.indexOf("0019_user_profile")).toBeGreaterThan(
			tags.indexOf("0018_elpx_has_screenshot"),
		);
	});
});

// Issue #432: los itinerarios del Procomún antiguo se importan como colecciones.
// La clave de importación es (import_source, external_id), como en resources.
// #512 tiene reservadas la 0020 y la 0021: esta es la 0022.
describe("migración 0022_collections_legacy_import", () => {
	const OLD_COLLECTIONS = `CREATE TABLE "collections" (
		id TEXT PRIMARY KEY,
		slug VARCHAR(512) NOT NULL UNIQUE,
		title TEXT NOT NULL
	)`;
	const COLUMNS_QUERY = `SELECT column_name FROM information_schema.columns
		WHERE table_name = 'collections'
		AND column_name IN ('import_source', 'external_id', 'published_at')
		ORDER BY column_name`;
	const insert = (id: string, externalId: string | null) =>
		`INSERT INTO "collections" (id, slug, title, import_source, external_id)
		VALUES ('${id}', '${id}', 'T', 'legacy-procomun', ${externalId ? `'${externalId}'` : "NULL"})`;

	test("va la última en el journal, con un when mayor que el de 0019", async () => {
		const journal = JSON.parse(
			await readFile(path.join(migrationsDir, "meta/_journal.json"), "utf8"),
		) as { entries: Array<{ idx: number; tag: string; when: number }> };
		const last = journal.entries.at(-1);
		expect(last?.tag).toBe("0022_collections_legacy_import");
		expect(last?.idx).toBe(journal.entries.length - 1);
		expect(last?.when ?? 0).toBeGreaterThan(1793500000000);
	});

	async function assertSchema(db: PGlite) {
		expect((await db.query(COLUMNS_QUERY)).rows).toEqual([
			{ column_name: "external_id" },
			{ column_name: "import_source" },
			{ column_name: "published_at" },
		]);
		await db.exec(insert("c1", "it-1"));
		// Dos colecciones con la misma clave de importación no pueden existir.
		await expect(db.exec(insert("c2", "it-1"))).rejects.toThrow();
		// Las que no vienen de una importación no se restringen entre sí.
		await db.exec(insert("c3", null));
		await db.exec(insert("c4", null));
	}

	test("añade las columnas y el índice único parcial, y se puede aplicar dos veces", async () => {
		const migration = (
			await readFile(
				path.join(migrationsDir, "0022_collections_legacy_import.sql"),
				"utf8",
			)
		).replaceAll("--> statement-breakpoint", "");
		const db = new PGlite();
		try {
			await db.exec(OLD_COLLECTIONS);
			await db.exec(migration);
			await db.exec(migration);
			await assertSchema(db);
		} finally {
			await db.close();
		}
	});

	test("createTables deja el mismo esquema en una base nueva y en una previa", async () => {
		const { createTables } = await import("./setup.ts");
		const fresh = new PGlite();
		try {
			await createTables(fresh);
			await fresh.exec(
				`INSERT INTO "user" (id, email, name) VALUES ('u1', 'u1@ejemplo.test', 'U')`,
			);
			expect((await fresh.query(COLUMNS_QUERY)).rows).toHaveLength(3);
			const insertWithCurator = (id: string, externalId: string) =>
				`INSERT INTO "collections" (id, slug, title, description, curator_id, import_source, external_id)
				VALUES ('${id}', '${id}', 'T', 'D', 'u1', 'legacy-procomun', '${externalId}')`;
			await fresh.exec(insertWithCurator("c1", "it-1"));
			await expect(
				fresh.exec(insertWithCurator("c2", "it-1")),
			).rejects.toThrow();
		} finally {
			await fresh.close();
		}

		const previous = new PGlite();
		try {
			await previous.exec(OLD_COLLECTIONS);
			for (const statement of SCHEMA_STATEMENTS.filter(
				(s) =>
					/collections/i.test(s) &&
					/import_source|external_id|published_at/.test(s),
			)) {
				await previous.exec(statement);
			}
			await assertSchema(previous);
		} finally {
			await previous.close();
		}
	});
});
