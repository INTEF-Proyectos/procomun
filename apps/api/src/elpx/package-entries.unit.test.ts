import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildStoredElpxPreview } from "./package-entries.ts";

const previous = process.env.UPLOAD_STORAGE_DIR;
let tempDir: string | null = null;

afterEach(async () => {
	if (previous === undefined) delete process.env.UPLOAD_STORAGE_DIR;
	else process.env.UPLOAD_STORAGE_DIR = previous;
	if (tempDir) await rm(tempDir, { recursive: true, force: true });
	tempDir = null;
});

describe("buildStoredElpxPreview", () => {
	test("no promociona screenshot del tema ni audio como portada", async () => {
		tempDir = await mkdtemp(path.join(os.tmpdir(), "elpx-cover-"));
		process.env.UPLOAD_STORAGE_DIR = tempDir;
		const hash = "abc123def456";
		const root = path.join(tempDir, "elpx", hash);
		await mkdir(path.join(root, "theme"), { recursive: true });
		await mkdir(path.join(root, "content/resources/audio"), {
			recursive: true,
		});
		await writeFile(path.join(root, "theme/screenshot.png"), "png");
		await writeFile(
			path.join(root, "content/resources/audio/b00039.ogg"),
			"ogg",
		);

		const preview = await buildStoredElpxPreview({ hash, hasPreview: true });
		expect(preview?.coverImageUrl).toBeNull();
		expect(preview?.previewUrl).toBe(`/api/v1/elpx/${hash}/`);
	});

	test("usa content/resources/cover.png cuando existe", async () => {
		tempDir = await mkdtemp(path.join(os.tmpdir(), "elpx-cover-"));
		process.env.UPLOAD_STORAGE_DIR = tempDir;
		const hash = "abc123def456";
		const root = path.join(tempDir, "elpx", hash);
		await mkdir(path.join(root, "content/resources"), { recursive: true });
		await writeFile(path.join(root, "content/resources/cover.png"), "png");

		const preview = await buildStoredElpxPreview({ hash, hasPreview: true });
		expect(preview?.coverImageUrl).toBe(
			`/api/v1/elpx/${hash}/content/resources/cover.png`,
		);
	});
});
