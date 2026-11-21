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
import { pruneThumbnails } from "./thumbnails-prune.ts";

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
