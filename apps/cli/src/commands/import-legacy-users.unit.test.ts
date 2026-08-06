import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mapLegacyUser } from "@procomun/db/legacy-import";
import {
	type loadImportLegacyUsersDependencies,
	runImportLegacyUsers,
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
});
