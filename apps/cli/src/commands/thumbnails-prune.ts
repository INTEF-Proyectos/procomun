import { lstat, readdir, unlink } from "node:fs/promises";
import type { DrizzleDB } from "@procomun/db/repository";
import { collections, elpxProjects, resources } from "@procomun/db/schema";
import { isNotNull } from "drizzle-orm";
import {
	THUMBNAIL_FILE_RE,
	THUMBNAIL_PUBLIC_PREFIX,
	thumbnailPath,
} from "../../../api/src/services/legacy-preview-image.ts";

const GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export async function pruneThumbnails(
	db: DrizzleDB,
	storageDir: string,
	dryRun: boolean,
	now = new Date(),
) {
	const dir = thumbnailPath(storageDir, "");
	const empty = { files: [] as string[], bytes: 0 };
	const directory = await lstat(dir).catch((error) => {
		if (error.code !== "ENOENT") throw error;
		return null;
	});
	if (!directory) return empty;
	if (!directory.isDirectory())
		throw new Error("El almacén de miniaturas no es un directorio");

	const entries = (await readdir(dir, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && THUMBNAIL_FILE_RE.test(entry.name))
		.map(({ name }) => name)
		.sort();
	if (!entries.length) return empty;

	// Incluye proyectos históricos y recursos dados de baja que se pueden restaurar.
	const rows = await db
		.select({ reference: elpxProjects.thumbnailFile })
		.from(elpxProjects)
		.where(isNotNull(elpxProjects.thumbnailFile))
		.union(
			db
				.select({ reference: resources.thumbnailUrl })
				.from(resources)
				.where(isNotNull(resources.thumbnailUrl)),
		)
		.union(
			db
				.select({ reference: collections.coverImageUrl })
				.from(collections)
				.where(isNotNull(collections.coverImageUrl)),
		);
	const referenced = new Set(
		rows.map(({ reference }) => {
			const url = reference?.split(/[?#]/, 1)[0] ?? "";
			return url.includes(THUMBNAIL_PUBLIC_PREFIX)
				? url.split("/").at(-1)
				: url;
		}),
	);

	const cutoff = now.getTime() - GRACE_MS;
	const report = empty;
	for (const file of entries) {
		if (referenced.has(file)) continue;
		const path = thumbnailPath(storageDir, file);
		try {
			const stat = await lstat(path);
			if (!stat.isFile() || stat.mtimeMs >= cutoff) continue;
			if (!dryRun) await unlink(path);
			report.files.push(file);
			report.bytes += stat.size;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	return report;
}

export async function thumbnailsPrune(args: string[]) {
	if (args.some((arg) => arg !== "--dry-run"))
		throw new Error("Uso: thumbnails:prune [--dry-run]");
	const [{ getDb, waitForDb }, { getUploadConfig }] = await Promise.all([
		import("../../../api/src/db.ts"),
		import("../../../api/src/uploads/config.ts"),
	]);
	await waitForDb();
	const dryRun = args.includes("--dry-run");
	const { files, bytes } = await pruneThumbnails(
		getDb().db,
		getUploadConfig().storageDir,
		dryRun,
	);
	console.log(JSON.stringify({ dryRun, files, bytes }, null, 2));
}
