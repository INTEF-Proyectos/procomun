import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { mapLegacyUser } from "@procomun/db/legacy-import";
import {
	findLegacyUserImportConflict,
	fixLegacyUserRole,
	importLegacyUser,
} from "@procomun/db/repository";
import * as schema from "@procomun/db/schema";
import { createTables } from "@procomun/db/setup";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import {
	closeCliDb,
	type loadImportLegacyUsersDependencies,
	parseImportLegacyUsersArgs,
	runFixLegacyUserRoles,
	runImportLegacyUsers,
	runImportLegacyUsersCommand,
} from "./import-legacy-users.ts";

type Deps = Awaited<ReturnType<typeof loadImportLegacyUsersDependencies>>;

function buildDeps(overrides: Partial<Deps> = {}): Deps {
	return {
		getDb: () => ({
			db: {} as ReturnType<Deps["getDb"]>["db"],
			provider: "pg",
		}),
		waitForDb: async () => {},
		mapLegacyUser,
		findLegacyUserImportConflict: async () => null,
		importLegacyUser: async (_db, mapped) => ({
			outcome: "imported",
			id: mapped.id,
		}),
		fixLegacyUserRole: async (_db, mapped) => ({
			outcome: "unchanged",
			id: mapped.id,
			role: mapped.role,
		}),
		...overrides,
	};
}

describe("runImportLegacyUsers", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "legacy-users-"));
	});

	test("dry-run informa conflictos existentes y duplicados sin insertar", async () => {
		const sourceFile = path.join(dir, "usuarios.json");
		await writeFile(
			sourceFile,
			JSON.stringify([
				{ uid: 1, mail: "id@example.test", roles: "-", status: 1 },
				{ uid: 2, mail: "email@example.test", roles: "-", status: 1 },
				{ uid: 3, mail: "duplicate@example.test", roles: "-", status: 1 },
				{ uid: 4, mail: "DUPLICATE@example.test", roles: "-", status: 1 },
			]),
		);
		let persisted = false;
		const report = await runImportLegacyUsers(
			{ sourceFile, dryRun: true },
			buildDeps({
				findLegacyUserImportConflict: async (_db, mapped) => {
					if (mapped.legacyUid === "1") {
						return { outcome: "skipped_existing_id", id: "existing-id" };
					}
					if (mapped.legacyUid === "2") {
						return { outcome: "skipped_existing_email", id: "existing-email" };
					}
					return null;
				},
				importLegacyUser: async () => {
					persisted = true;
					return { outcome: "imported", id: "unexpected" };
				},
			}),
		);

		expect(persisted).toBeFalse();
		expect(report.totals).toMatchObject({
			imported: 0,
			wouldImport: 1,
			skippedExistingId: 1,
			skippedExistingEmail: 2,
		});
		expect(report.records.map((record) => record.outcome)).toEqual([
			"skipped_existing_id",
			"skipped_existing_email",
			"would_import",
			"skipped_existing_email",
		]);
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	test("importa los registros válidos e informa errores aislados", async () => {
		const sourceFile = path.join(dir, "usuarios.json");
		await writeFile(
			sourceFile,
			JSON.stringify([
				{
					uid: 1,
					name: "Admin",
					mail: "admin@example.test",
					roles: "administrator",
					status: 1,
					pass: "$P$legacy",
				},
				{ uid: 2, mail: "email-no-valido", roles: "-", status: 1 },
				{
					uid: 3,
					name: "Autora",
					mail: "author@example.test",
					roles: "-",
					status: 0,
				},
			]),
		);

		const report = await runImportLegacyUsers(
			{ sourceFile, dryRun: false },
			buildDeps(),
		);

		expect(report.totals).toEqual({
			found: 3,
			processed: 3,
			imported: 2,
			wouldImport: 0,
			skippedExistingId: 0,
			skippedExistingEmail: 0,
			errored: 1,
			importedBlocked: 1,
			withoutPassword: 2,
		});
		expect(report.records.map((record) => record.outcome)).toEqual([
			"imported",
			"error",
			"imported",
		]);
	});

	test("importa bloqueados los status 0 y los cuenta, también en dry-run", async () => {
		const sourceFile = path.join(dir, "usuarios.json");
		await writeFile(
			sourceFile,
			JSON.stringify([
				{ uid: 20, mail: "bloq@example.test", roles: "-", status: 0 },
				{ uid: 21, mail: "activa@example.test", roles: "-", status: 1 },
			]),
		);
		for (const dryRun of [false, true]) {
			const created: string[] = [];
			const report = await runImportLegacyUsers(
				{ sourceFile, dryRun },
				buildDeps({
					findLegacyUserImportConflict: async () => null,
					importLegacyUser: async (_db, mapped) => {
						created.push(mapped.legacyUid);
						return { outcome: "imported", id: mapped.id };
					},
				}),
			);
			expect(created).toEqual(dryRun ? [] : ["20", "21"]);
			expect(report.totals.importedBlocked).toBe(1);
			expect(report.records[0]).toMatchObject({
				outcome: dryRun ? "would_import" : "imported",
				legacyUid: "20",
				blocked: true,
			});
			expect(report.records[1]).toMatchObject({ blocked: false });
		}
	});

	test("lista en el informe los roles sin correspondencia, el rol asignado y lo completado", async () => {
		const sourceFile = path.join(dir, "usuarios.json");
		await writeFile(
			sourceFile,
			JSON.stringify([
				{ uid: 10, mail: "org@example.test", roles: "Organization", status: 1 },
				{
					uid: 11,
					mail: "org2@example.test",
					roles: "Organization, publicador_certificado",
					status: 1,
				},
				{ uid: 12, mail: "otro@example.test", roles: "rol_raro", status: 1 },
				{ uid: 13, mail: "ya@example.test", roles: "-", status: 1 },
			]),
		);

		const report = await runImportLegacyUsers(
			{ sourceFile, dryRun: false },
			buildDeps({
				importLegacyUser: async (_db, mapped) =>
					mapped.legacyUid === "13"
						? {
								outcome: "skipped_existing_id",
								id: mapped.id,
								completed: ["password"],
							}
						: { outcome: "imported", id: mapped.id },
			}),
		);

		expect(report.unknownRoles).toEqual([
			{ role: "Organization", count: 2, legacyUids: ["10", "11"] },
			{ role: "rol_raro", count: 1, legacyUids: ["12"] },
		]);
		expect(report.records).toContainEqual(
			expect.objectContaining({
				outcome: "imported",
				legacyUid: "11",
				role: "editor",
			}),
		);
		// #507: los desconocidos y los sin rol entran como editor, no como author.
		for (const legacyUid of ["10", "12"]) {
			expect(report.records).toContainEqual(
				expect.objectContaining({
					outcome: "imported",
					legacyUid,
					role: "editor",
				}),
			);
		}
		expect(report.records).toContainEqual({
			outcome: "skipped_existing_id",
			legacyUid: "13",
			userId: "legacy-procomun:user:13",
			completed: ["password"],
		});
		// El informe no lleva correos ni otros datos personales.
		expect(JSON.stringify(report)).not.toContain("@example.test");
	});

	test("dry-run valida sin persistir y respeta --limit", async () => {
		const sourceFile = path.join(dir, "usuarios.json");
		await writeFile(
			sourceFile,
			JSON.stringify([
				{ uid: 1, mail: "one@example.test", roles: "-", status: 1 },
				{ uid: 2, mail: "two@example.test", roles: "-", status: 1 },
			]),
		);
		let persisted = false;
		const report = await runImportLegacyUsers(
			{ sourceFile, dryRun: true, limit: 1 },
			buildDeps({
				importLegacyUser: async () => {
					persisted = true;
					return { outcome: "imported", id: "unexpected" };
				},
			}),
		);

		expect(persisted).toBeFalse();
		expect(report.totals.processed).toBe(1);
		expect(report.records[0]?.outcome).toBe("would_import");
	});

	test("cierra PGlite si la lectura del JSON falla antes de crear el informe", async () => {
		let closed = false;
		const missingSourceFile = path.join(dir, "missing.json");
		await expect(
			runImportLegacyUsersCommand(
				{
					sourceFile: missingSourceFile,
					fixRoles: false,
					dryRun: false,
					limit: undefined,
					reportDir: path.join(dir, "reports"),
				},
				buildDeps({
					getDb: () => ({
						db: {
							$client: {
								close: async () => {
									closed = true;
								},
							},
						} as unknown as ReturnType<Deps["getDb"]>["db"],
						provider: "pg",
					}),
				}),
			),
		).rejects.toThrow();
		expect(closed).toBeTrue();
	});
});

describe("import:legacy-users --fix-roles (#507)", () => {
	let dir: string;
	let pglite: PGlite;
	let db: ReturnType<Deps["getDb"]>["db"];

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "legacy-users-fix-"));
		pglite = new PGlite();
		await createTables(pglite);
		db = drizzle(pglite, { schema }) as unknown as typeof db;
	});

	afterEach(async () => {
		// El comando cierra PGlite al terminar, como en una ejecución real.
		if (!pglite.closed) await pglite.close();
		await rm(dir, { recursive: true, force: true });
	});

	function realDeps(): Deps {
		return buildDeps({
			getDb: () => ({ db, provider: "pg" }),
			findLegacyUserImportConflict,
			importLegacyUser,
			fixLegacyUserRole,
		});
	}

	const SOURCE = [
		{ uid: 1, mail: "sin-rol@example.test", roles: "-", status: 1 },
		{ uid: 2, mail: "doc@example.test", roles: "bm_documentalista", status: 0 },
		{ uid: 3, mail: "admin@example.test", roles: "administrator", status: 1 },
		{ uid: 4, mail: "curadora@example.test", roles: "-", status: 1 },
		{ uid: 5, mail: "org@example.test", roles: "Organization", status: 1 },
		{ uid: 6, mail: "nativa@example.test", roles: "-", status: 1 },
		{ uid: 7, mail: "no-es-un-correo", roles: "-", status: 1 },
		{
			uid: 8,
			mail: "certificada@example.test",
			roles: "publicador_certificado",
			status: 1,
		},
	];

	/** Base como la dejó #488: legacy importados como author, más cuentas ajenas. */
	async function seedImportedAsAuthor() {
		for (const record of SOURCE.filter((r) =>
			[1, 2, 3, 4, 5, 8].includes(r.uid),
		)) {
			await importLegacyUser(db, mapLegacyUser(record));
		}
		const legacyRole = (uid: number, role: string) =>
			db
				.update(schema.user)
				.set({ role })
				.where(eq(schema.user.id, `legacy-procomun:user:${uid}`));
		await legacyRole(1, "author");
		await legacyRole(2, "author");
		await legacyRole(4, "curator");
		await legacyRole(5, "author");
		// Cuenta nativa con el mismo correo que el uid 6, que nunca se importó.
		await db.insert(schema.user).values({
			id: "native-6",
			email: "nativa@example.test",
			role: "author",
		});
	}

	async function roles() {
		const rows = await db
			.select({ id: schema.user.id, role: schema.user.role })
			.from(schema.user);
		return Object.fromEntries(rows.map((row) => [row.id, row.role]));
	}

	test("relee el JSON y pasa a editor solo las cuentas legacy author; dry-run no escribe y repetir no cambia nada", async () => {
		const sourceFile = path.join(dir, "usuarios.json");
		await writeFile(sourceFile, JSON.stringify(SOURCE));
		await seedImportedAsAuthor();
		const before = await roles();

		const dry = await runFixLegacyUserRoles(
			{ sourceFile, dryRun: true },
			realDeps(),
		);
		expect(await roles()).toEqual(before);
		expect(dry.dryRun).toBeTrue();
		expect(dry.totals).toEqual({
			found: 8,
			processed: 8,
			fixed: 3,
			unchanged: 2,
			kept: 1,
			notFound: 1,
			errored: 1,
		});
		expect(
			dry.records.flatMap((r) =>
				r.outcome === "would_fix" ? [r.legacyUid] : [],
			),
		).toEqual(["1", "2", "5"]);

		const real = await runFixLegacyUserRoles(
			{ sourceFile, dryRun: false },
			realDeps(),
		);
		expect(real.totals).toEqual(dry.totals);
		expect(real.records).toEqual([
			{
				outcome: "fixed",
				legacyUid: "1",
				userId: "legacy-procomun:user:1",
				from: "author",
				to: "editor",
			},
			{
				outcome: "fixed",
				legacyUid: "2",
				userId: "legacy-procomun:user:2",
				from: "author",
				to: "editor",
			},
			{
				outcome: "kept",
				legacyUid: "4",
				userId: "legacy-procomun:user:4",
				role: "curator",
				mappedRole: "editor",
			},
			{
				outcome: "fixed",
				legacyUid: "5",
				userId: "legacy-procomun:user:5",
				from: "author",
				to: "editor",
			},
			{
				outcome: "not_found",
				legacyUid: "6",
				userId: "legacy-procomun:user:6",
			},
			{ outcome: "error", index: 6, message: "mail ausente o inválido" },
		]);
		expect(real.unknownRoles).toEqual([
			{ role: "Organization", count: 1, legacyUids: ["5"] },
		]);
		expect(await roles()).toEqual({
			...before,
			"legacy-procomun:user:1": "editor",
			"legacy-procomun:user:2": "editor",
			"legacy-procomun:user:5": "editor",
		});
		// La cuenta nativa, la admin y la curator no cambian.
		expect((await roles())["native-6"]).toBe("author");
		expect((await roles())["legacy-procomun:user:3"]).toBe("admin");
		expect((await roles())["legacy-procomun:user:4"]).toBe("curator");
		// El uid 2 sigue bloqueado.
		const [blocked] = await db
			.select()
			.from(schema.user)
			.where(eq(schema.user.id, "legacy-procomun:user:2"));
		expect(blocked?.isActive).toBeFalse();
		expect(blocked?.banned).toBeTrue();

		const again = await runFixLegacyUserRoles(
			{ sourceFile, dryRun: false },
			realDeps(),
		);
		expect(again.totals).toMatchObject({ fixed: 0, unchanged: 5, kept: 1 });
		expect(await db.select().from(schema.user)).toHaveLength(7);
		// El informe no lleva correos.
		expect(JSON.stringify(real)).not.toContain("@example.test");
	});

	test("el comando escribe el informe de corrección y respeta --limit", async () => {
		const sourceFile = path.join(dir, "usuarios.json");
		await writeFile(sourceFile, JSON.stringify(SOURCE));
		await seedImportedAsAuthor();
		const reportDir = path.join(dir, "reports");

		const exitCode = await runImportLegacyUsersCommand(
			parseImportLegacyUsersArgs([
				"--fix-roles",
				"--source-file",
				sourceFile,
				"--limit",
				"2",
				"--report-dir",
				reportDir,
			]),
			realDeps(),
		);
		expect(exitCode).toBe(0);
		expect(pglite.closed).toBeTrue();
		const [reportName] = await readdir(reportDir);
		expect(reportName).toStartWith("informe_usuarios-correccion-roles-");
		const report = await Bun.file(
			path.join(reportDir, reportName ?? ""),
		).json();
		expect(report.dryRun).toBeFalse();
		expect(report.totals).toMatchObject({ found: 8, processed: 2, fixed: 2 });
		expect(
			report.records.map((record: { userId: string }) => record.userId),
		).toEqual(["legacy-procomun:user:1", "legacy-procomun:user:2"]);
	});

	test("en dry-run el informe del comando lo indica en el nombre", async () => {
		const sourceFile = path.join(dir, "usuarios.json");
		await writeFile(sourceFile, JSON.stringify(SOURCE));
		const reportDir = path.join(dir, "reports");

		const exitCode = await runImportLegacyUsersCommand(
			parseImportLegacyUsersArgs([
				"--fix-roles",
				"--dry-run",
				"--source-file",
				sourceFile,
				"--report-dir",
				reportDir,
			]),
			realDeps(),
		);
		// El registro con el correo no válido cuenta como error.
		expect(exitCode).toBe(1);
		const [reportName] = await readdir(reportDir);
		expect(reportName).toStartWith("informe_usuarios-correccion-roles-dryrun-");
	});
});

describe("parseImportLegacyUsersArgs", () => {
	test("--fix-roles necesita --source-file y admite --dry-run", () => {
		expect(() => parseImportLegacyUsersArgs(["--fix-roles"])).toThrow(
			"--source-file",
		);
		const options = parseImportLegacyUsersArgs([
			"--fix-roles",
			"--source-file",
			"usuarios.json",
			"--dry-run",
		]);
		expect(options).toMatchObject({ fixRoles: true, dryRun: true });
		expect(
			parseImportLegacyUsersArgs(["--source-file", "u.json"]).fixRoles,
		).toBeFalse();
	});
});

describe("closeCliDb", () => {
	test("cierra el cliente PGlite expuesto por Drizzle", async () => {
		let closed = false;
		await closeCliDb({
			$client: {
				close: async () => {
					closed = true;
				},
			},
		});
		expect(closed).toBeTrue();
	});

	test("tolera drivers sin close y errores durante el cierre", async () => {
		await expect(closeCliDb({})).resolves.toBeUndefined();
		await expect(
			closeCliDb({
				$client: {
					close: async () => Promise.reject(new Error("close failed")),
				},
			}),
		).resolves.toBeUndefined();
	});
});
