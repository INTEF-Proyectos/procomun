import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mapLegacyUser } from "@procomun/db/legacy-import";
import {
	closeCliDb,
	type loadImportLegacyUsersDependencies,
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

	test("importa los registros válidos, informa errores aislados y no migra contraseñas", async () => {
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
		});
		expect(report.records.map((record) => record.outcome)).toEqual([
			"imported",
			"error",
			"imported",
		]);
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
