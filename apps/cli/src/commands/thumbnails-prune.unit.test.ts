import { expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readdir,
	rm,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "@procomun/db/schema";
import { drizzle } from "drizzle-orm/pglite";
import {
	assertExistingDatabase,
	pruneThumbnails,
	thumbnailsPrune,
} from "./thumbnails-prune.ts";

test("solo elimina las miniaturas huérfanas antiguas y simula sin borrar (#520)", async () => {
	const root = await mkdtemp(join(tmpdir(), "procomun-prune-"));
	const dir = join(root, "thumbnails");
	const db = new PGlite();
	const thumbnail = (digit: string) => `${digit.repeat(64)}.png`;
	const [orphan, project, resource, cover, recent, link] = [
		thumbnail("0"),
		thumbnail("1"),
		thumbnail("2"),
		thumbnail("3"),
		thumbnail("4"),
		thumbnail("5"),
	] as const;
	const now = new Date("2026-11-21T00:00:00Z");
	const old = new Date("2026-11-01T00:00:00Z");
	try {
		await db.exec(`
			CREATE TABLE elpx_projects (thumbnail_file text);
			CREATE TABLE resources (thumbnail_url text);
			CREATE TABLE collections (cover_image_url text);
		`);
		await db.query("INSERT INTO elpx_projects VALUES ($1)", [project]);
		await db.query("INSERT INTO resources VALUES ($1)", [
			`/api/v1/thumbnails/${resource}`,
		]);
		await db.query("INSERT INTO collections VALUES ($1)", [
			`https://ejemplo.test/api/v1/thumbnails/${cover}?v=1`,
		]);
		await mkdir(dir);
		for (const file of [orphan, project, resource, cover, recent, "otro.png"]) {
			const path = join(dir, file);
			await writeFile(path, "test");
			const time = file === recent ? now : old;
			await utimes(path, time, time);
		}
		await symlink(join(dir, orphan), join(dir, link));
		const database = drizzle(db, { schema });
		const dryRun = await pruneThumbnails(database, root, true, now);
		expect(dryRun).toEqual({ files: [orphan], bytes: 4 });
		expect(await readdir(dir)).toContain(orphan);
		expect(await pruneThumbnails(database, root, false, now)).toEqual(dryRun);
		expect((await readdir(dir)).sort()).toEqual(
			[project, resource, cover, recent, link, "otro.png"].sort(),
		);
		expect(await pruneThumbnails(database, root, false, now)).toEqual({
			files: [],
			bytes: 0,
		});
	} finally {
		await db.close();
		await rm(root, { recursive: true, force: true });
	}
});

test("acepta DATABASE_URL o un PGLITE_DIR con una base ya creada (#630)", async () => {
	const root = await mkdtemp(join(tmpdir(), "procomun-prune-db-"));
	try {
		const db = new PGlite(root);
		await db.query("SELECT 1");
		await db.close();
		await assertExistingDatabase({ PGLITE_DIR: root });
		await assertExistingDatabase({ PGLITE_DIR: `file://${root}` });
		await assertExistingDatabase({ DATABASE_URL: "postgres://x/y" });
		await expect(
			assertExistingDatabase({ PGLITE_DIR: join(root, "otra") }),
		).rejects.toThrow(/PGLITE_DIR/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("sin una base configurada y ya creada sale con error antes de tocar el almacén (#630)", async () => {
	const root = await mkdtemp(join(tmpdir(), "procomun-prune-"));
	const dir = join(root, "thumbnails");
	const orphan = `${"0".repeat(64)}.png`;
	const keys = ["DATABASE_URL", "PGLITE_DIR", "UPLOAD_STORAGE_DIR"] as const;
	const saved = keys.map((key) => process.env[key]);
	const old = new Date("2026-01-01T00:00:00Z");
	try {
		await mkdir(dir);
		await writeFile(join(dir, orphan), "test");
		await utimes(join(dir, orphan), old, old);
		delete process.env.DATABASE_URL;
		process.env.UPLOAD_STORAGE_DIR = root;
		for (const pgliteDir of [undefined, "memory://", join(root, "sin-base")]) {
			if (pgliteDir === undefined) delete process.env.PGLITE_DIR;
			else process.env.PGLITE_DIR = pgliteDir;
			for (const args of [["--dry-run"], []]) {
				await expect(thumbnailsPrune(args)).rejects.toThrow(
					/DATABASE_URL|PGLITE_DIR/,
				);
				expect(await readdir(dir)).toEqual([orphan]);
			}
		}
	} finally {
		keys.forEach((key, index) => {
			const value = saved[index];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		});
		await rm(root, { recursive: true, force: true });
	}
});
