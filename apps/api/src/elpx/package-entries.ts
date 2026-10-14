import { type Dirent, readdir } from "node:fs/promises";
import path from "node:path";
import { getUploadConfig } from "../uploads/config.ts";
import { buildElpxPreview } from "./preview.ts";

async function walk(root: string, dir: string, out: string[]): Promise<void> {
	let entries: Dirent[];
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const abs = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			await walk(root, abs, out);
		} else if (entry.isFile()) {
			out.push(path.relative(root, abs).split(path.sep).join("/"));
		}
	}
}

export async function listElpxPackageEntries(hash: string): Promise<string[]> {
	const root = path.join(getUploadConfig().storageDir, "elpx", hash);
	const out: string[] = [];
	await walk(root, root, out);
	return out;
}

export async function buildStoredElpxPreview(
	elpx: { hash?: string; hasPreview?: boolean } | null | undefined,
) {
	if (!elpx?.hasPreview || !elpx.hash) return buildElpxPreview(elpx);
	return buildElpxPreview(elpx, await listElpxPackageEntries(elpx.hash));
}
