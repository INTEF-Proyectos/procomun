import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { getEducationalCategory } from "@procomun/db/educational-areas";
import {
	DEMO_COLLECTIONS,
	DEMO_FAVORITES,
	DEMO_RATINGS,
	DEMO_RESOURCES,
	DEMO_USERS,
} from "@procomun/db/seed-data";
import { createTables } from "@procomun/db/setup";
import {
	formatPostgresSeedTarget,
	insertSeedElpxProject,
	resolveSeedMode,
	seedWithClient,
} from "./seed.ts";

describe("resolveSeedMode", () => {
	test("usa postgres si DATABASE_URL está definida", () => {
		expect(resolveSeedMode({ DATABASE_URL: "postgres://localhost/db" })).toBe(
			"postgres",
		);
	});

	test("usa pglite si DATABASE_URL no está definida", () => {
		expect(resolveSeedMode({})).toBe("pglite");
	});
});

describe("formatPostgresSeedTarget", () => {
	test("redacta credenciales y conserva host, puerto y base de datos", () => {
		expect(
			formatPostgresSeedTarget(
				"postgres://user:secret@db.example.com:6543/procomun",
			),
		).toBe("Base PostgreSQL: db.example.com:6543/procomun");
	});
});

describe("seedWithClient", () => {
	test(
		"limpia la semilla y vuelve a insertarla, conservando los usuarios de demo",
		async () => {
			const calls: Array<{ statement: string; params?: unknown[] }> = [];
			const logs: string[] = [];
			let closed = false;

			await seedWithClient(
				{
					async query(statement, params) {
						calls.push({ statement, params });
						return { rows: [] };
					},
					async close() {
						closed = true;
					},
				},
				{
					now: "2026-03-27T10:00:00.000Z",
					log: { log: (message: string) => logs.push(message) },
					successTarget: "Directorio PGlite: /tmp/procomun",
				},
			);

			expect(closed).toBe(true);

			// Verifica limpieza previa (DELETE)
			// Los usuarios de demo se conservan (#452): se actualizan, no se borran.
			expect(
				calls.some((c) => c.statement.includes('DELETE FROM "user"')),
			).toBe(false);
			expect(
				calls.some((c) =>
					c.statement.includes('DELETE FROM "resource_versions"'),
				),
			).toBe(true);
			expect(
				calls.some((c) => c.statement.includes('DELETE FROM "resources"')),
			).toBe(true);
			expect(
				calls.some((c) => c.statement.includes('DELETE FROM "collections"')),
			).toBe(true);
			expect(
				calls.some((c) => c.statement.includes('DELETE FROM "ratings"')),
			).toBe(true);
			expect(
				calls.some((c) => c.statement.includes('DELETE FROM "favorites"')),
			).toBe(true);
			expect(
				calls.some((c) => c.statement.includes('DELETE FROM "downloads"')),
			).toBe(true);
			// Ni se quita la autoría de los recursos que no son de la semilla.
			expect(
				calls.some((c) => c.statement.includes('UPDATE "resources" SET')),
			).toBe(false);

			// Verifica inserciones
			const userInserts = calls.filter((c) =>
				c.statement.includes('INSERT INTO "user"'),
			);
			expect(userInserts.length).toBe(DEMO_USERS.length);
			expect(
				userInserts.every((c) => c.statement.includes("ON CONFLICT (id)")),
			).toBe(true);
			expect(
				calls.filter((c) => c.statement.includes('INSERT INTO "account"'))
					.length,
			).toBe(DEMO_USERS.length);
			expect(
				calls.filter((c) => c.statement.includes('INSERT INTO "resources"'))
					.length,
			).toBe(DEMO_RESOURCES.length);
			expect(
				calls.some((c) =>
					c.statement.includes('INSERT INTO "resource_subjects"'),
				),
			).toBe(true);
			expect(
				calls.some((c) =>
					c.statement.includes('INSERT INTO "resource_levels"'),
				),
			).toBe(true);
			// Los niveles de demo que son ids del catálogo se guardan como categoría.
			const areaInserts = calls.filter((c) =>
				c.statement.includes('INSERT INTO "resource_educational_areas"'),
			);
			expect(areaInserts.map((c) => c.params)).toEqual(
				DEMO_RESOURCES.flatMap((r) =>
					r.levels
						.filter((level) => getEducationalCategory(level))
						.map((level) => [r.id, level]),
				),
			);
			expect(areaInserts.length).toBeGreaterThan(0);
			expect(
				calls.filter((c) => c.statement.includes('INSERT INTO "collections" '))
					.length,
			).toBe(DEMO_COLLECTIONS.length);
			expect(
				calls.some((c) =>
					c.statement.includes('INSERT INTO "collection_resources"'),
				),
			).toBe(true);
			expect(
				calls.filter((c) => c.statement.includes('INSERT INTO "ratings"'))
					.length,
			).toBe(DEMO_RATINGS.length);
			expect(
				calls.filter((c) => c.statement.includes('INSERT INTO "favorites"'))
					.length,
			).toBe(DEMO_FAVORITES.length);
			expect(
				calls.some((c) => c.statement.includes('INSERT INTO "downloads"')),
			).toBe(true);
			expect(
				calls.some((c) =>
					c.statement.includes('INSERT INTO "activity_events"'),
				),
			).toBe(true);

			// Verifica mensaje final
			expect(logs.at(-1)).toBe(
				"\nSeed completado. Directorio PGlite: /tmp/procomun",
			);
		},
		{ timeout: 60_000 },
	);

	test("cierra el cliente aunque falle una consulta", async () => {
		let closed = false;

		await expect(
			seedWithClient(
				{
					async query(statement) {
						if (statement.includes('INSERT INTO "account"')) {
							throw new Error("account insert failed");
						}
						return { rows: [] };
					},
					async close() {
						closed = true;
					},
				},
				{ successTarget: "Directorio PGlite: /tmp/procomun" },
			),
		).rejects.toThrow("account insert failed");

		expect(closed).toBe(true);
	});
});

describe("seedWithClient sobre una base real (#452)", () => {
	const DEMO_USER = DEMO_USERS[0]?.id ?? "";
	const SEED_RESOURCE = DEMO_RESOURCES[0]?.id ?? "";

	/** Seed sin .elpx sobre la misma base; el cierre lo hace el test. */
	function runSeed(db: PGlite) {
		return seedWithClient(
			{
				query: (statement, params) => db.query(statement, params),
				close: async () => {},
			},
			{
				now: "2026-10-26T10:00:00.000Z",
				log: { log: () => {} },
				successTarget: "test",
				withElpx: false,
			},
		);
	}

	/** Proyecto elpx + versión creada por `createdBy`, vigente en el recurso. */
	async function addVersion(db: PGlite, resourceId: string, createdBy: string) {
		const elpxId = `elpx-${resourceId}`;
		const versionId = `ver-${resourceId}`;
		await db.query(
			`INSERT INTO "elpx_projects" (id, resource_id, hash, extract_path, original_filename, version, has_preview, created_at, updated_at) VALUES ($1, $2, $3, '/tmp/x', 'x.elpx', 3, false, NOW(), NOW())`,
			[elpxId, resourceId, `hash-${resourceId}`],
		);
		await db.query(
			`INSERT INTO "resource_versions" (id, resource_id, version_number, elpx_project_id, file_sha256, metadata_snapshot, created_by) VALUES ($1, $2, 1, $3, $4, '{}', $5)`,
			[versionId, resourceId, elpxId, "a".repeat(64), createdBy],
		);
		await db.query(
			`UPDATE "resources" SET current_version_id = $1 WHERE id = $2`,
			[versionId, resourceId],
		);
	}

	test("el proyecto .elpx del seed nace con la miniatura en cola (#470)", async () => {
		const db = new PGlite();
		try {
			await createTables(db);
			await runSeed(db);
			const [resource] = (
				await db.query<{ id: string }>(`SELECT id FROM "resources" LIMIT 1`)
			).rows;
			const insert = (id: string, hasScreenshot: boolean) =>
				insertSeedElpxProject(
					{ query: (statement, params) => db.query(statement, params) },
					{
						id,
						resourceId: resource?.id ?? "",
						hash: `hash-${id}`,
						extractPath: "/tmp/x",
						filename: "x.elpx",
						hasPreview: true,
						hasScreenshot,
						metadata: {},
						now: "2026-10-26T10:00:00.000Z",
					},
				);
			await insert("elpx-sin-captura", false);
			await insert("elpx-con-captura", true);
			const { rows } = await db.query(
				`SELECT id, thumbnail_status FROM "elpx_projects" WHERE id LIKE 'elpx-%-captura' ORDER BY id`,
			);
			expect(rows).toEqual([
				{ id: "elpx-con-captura", thumbnail_status: "skipped" },
				{ id: "elpx-sin-captura", thumbnail_status: "pending" },
			]);
		} finally {
			await db.close();
		}
	});

	async function count(db: PGlite, sql: string, params: string[] = []) {
		const result = await db.query<{ n: number }>(sql, params);
		return Number(result.rows[0]?.n);
	}

	test(
		"repetir el seed conserva los recursos propios con versiones de un usuario de demo",
		async () => {
			const db = new PGlite();
			try {
				await createTables(db);
				await runSeed(db);

				// Recurso propio (no es de la semilla) con una versión del usuario de demo.
				await db.query(
					`INSERT INTO "resources" (id, slug, title, description, language, license, resource_type, author, created_by, editorial_status) VALUES ('propio-1', 'propio-1', 'Propio', 'Descripción', 'es', 'cc-by', 'proyecto', 'Autora', $1, 'draft')`,
					[DEMO_USER],
				);
				await addVersion(db, "propio-1", DEMO_USER);

				await runSeed(db);

				const own = await db.query<{
					created_by: string;
					current_version_id: string;
				}>(
					`SELECT created_by, current_version_id FROM "resources" WHERE id = 'propio-1'`,
				);
				expect(own.rows).toEqual([
					{ created_by: DEMO_USER, current_version_id: "ver-propio-1" },
				]);
				expect(
					await count(
						db,
						`SELECT COUNT(*) AS n FROM "resource_versions" WHERE id = 'ver-propio-1' AND created_by = $1`,
						[DEMO_USER],
					),
				).toBe(1);
			} finally {
				await db.close();
			}
		},
		{ timeout: 60_000 },
	);

	test(
		"repetir el seed limpia los recursos de la semilla que tienen versiones",
		async () => {
			const db = new PGlite();
			try {
				await createTables(db);
				await runSeed(db);
				await addVersion(db, SEED_RESOURCE, DEMO_USER);

				await runSeed(db);

				expect(
					await count(
						db,
						`SELECT COUNT(*) AS n FROM "resource_versions" WHERE resource_id = $1`,
						[SEED_RESOURCE],
					),
				).toBe(0);
				expect(
					await count(
						db,
						`SELECT COUNT(*) AS n FROM "resources" WHERE id = $1 AND current_version_id IS NULL`,
						[SEED_RESOURCE],
					),
				).toBe(1);
			} finally {
				await db.close();
			}
		},
		{ timeout: 60_000 },
	);

	test(
		"repetir el seed no duplica usuarios ni cuentas",
		async () => {
			const db = new PGlite();
			try {
				await createTables(db);
				await runSeed(db);
				await runSeed(db);

				const ids = DEMO_USERS.map((u) => u.id);
				const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
				expect(
					await count(
						db,
						`SELECT COUNT(*) AS n FROM "user" WHERE id IN (${placeholders})`,
						ids,
					),
				).toBe(DEMO_USERS.length);
				expect(
					await count(
						db,
						`SELECT COUNT(*) AS n FROM "account" WHERE provider_id = 'credential' AND user_id IN (${placeholders})`,
						ids,
					),
				).toBe(DEMO_USERS.length);
				expect(
					await count(
						db,
						`SELECT COUNT(*) AS n FROM "resources" WHERE id = $1`,
						[SEED_RESOURCE],
					),
				).toBe(1);
			} finally {
				await db.close();
			}
		},
		{ timeout: 60_000 },
	);
});
