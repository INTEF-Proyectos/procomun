import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as repo from "@procomun/db/repository";
import { getDb } from "../db.ts";
import { getUploadConfig, resolveStoredFilePath } from "../uploads/config.ts";
import {
	retireUploadArtifacts,
	retireWorkingCopyProject,
} from "./elpx-retire.ts";

let storageDir: string;
let previousStorageDir: string | undefined;

beforeAll(async () => {
	previousStorageDir = process.env.UPLOAD_STORAGE_DIR;
	storageDir = await mkdtemp(path.join(tmpdir(), "procomun-elpx-retire-"));
	process.env.UPLOAD_STORAGE_DIR = storageDir;
});

afterAll(async () => {
	if (previousStorageDir === undefined) {
		delete process.env.UPLOAD_STORAGE_DIR;
	} else {
		process.env.UPLOAD_STORAGE_DIR = previousStorageDir;
	}
	await rm(storageDir, { recursive: true, force: true }).catch(() => {});
});

const db = () => getDb().db;

async function seedResource() {
	const { id } = await repo.createResource(db(), {
		title: "Recurso retire",
		description: "Tests de retirada de copias de trabajo",
		language: "es",
		license: "cc-by",
		resourceType: "documento",
		createdBy: "1",
	});
	return id;
}

async function seedExtractionDir() {
	const dir = await mkdtemp(path.join(tmpdir(), "procomun-retire-extract-"));
	await writeFile(path.join(dir, "index.html"), "<html>x</html>");
	return dir;
}

describe("retireWorkingCopyProject", () => {
	test("elimina proyecto y extracción cuando no está versionado", async () => {
		const resourceId = await seedResource();
		const extractPath = await seedExtractionDir();
		const { id } = await repo.createElpxProject(db(), {
			resourceId,
			hash: crypto.randomUUID(),
			extractPath,
			originalFilename: "borrador.elpx",
		});

		const result = await retireWorkingCopyProject(db(), { id, extractPath });
		expect(result.retired).toBe(true);
		expect(existsSync(extractPath)).toBe(false);
		expect(await repo.getElpxProjectByResourceId(db(), resourceId)).toBeNull();
	});

	test("conserva proyecto y extracción cuando forma parte del historial", async () => {
		const resourceId = await seedResource();
		const extractPath = await seedExtractionDir();
		const { id } = await repo.createElpxProject(db(), {
			resourceId,
			hash: crypto.randomUUID(),
			extractPath,
			originalFilename: "v1.elpx",
		});
		await repo.publishResourceVersion(db(), {
			resourceId,
			elpxProjectId: id,
			createdBy: "1",
		});

		const result = await retireWorkingCopyProject(db(), { id, extractPath });
		expect(result.retired).toBe(false);
		expect(existsSync(extractPath)).toBe(true);
		const kept = await repo.getElpxProjectByResourceId(db(), resourceId);
		expect(kept?.id).toBe(id);
	});
});

describe("retireUploadArtifacts", () => {
	async function seedSession(resourceId: string) {
		const sessionId = crypto.randomUUID();
		await repo.createUploadSession(db(), {
			id: sessionId,
			resourceId,
			ownerId: "1",
			originalFilename: "archivo.elpx",
			mimeType: "application/zip",
			storageKey: `resource/${resourceId}/${sessionId}/archivo.elpx`,
			finalChecksum: "c3".repeat(32),
			declaredSize: 4,
			expiresAt: null,
		});
		const rawPath = resolveStoredFilePath(getUploadConfig(), sessionId);
		await mkdir(path.dirname(rawPath), { recursive: true });
		await writeFile(rawPath, "PKzz");
		return { sessionId, rawPath };
	}

	test("borra archivo y cancela sesión sin versiones asociadas", async () => {
		const resourceId = await seedResource();
		const { sessionId, rawPath } = await seedSession(resourceId);

		const result = await retireUploadArtifacts(db(), sessionId);
		expect(result.retired).toBe(true);
		expect(existsSync(rawPath)).toBe(false);
		const session = await repo.getUploadSessionById(db(), sessionId);
		expect(session?.status).toBe("cancelled");
	});

	test("conserva archivo y sesión cuando el .elpx está versionado", async () => {
		const resourceId = await seedResource();
		const { sessionId, rawPath } = await seedSession(resourceId);
		const { id: projectId } = await repo.createElpxProject(db(), {
			resourceId,
			hash: crypto.randomUUID(),
			extractPath: await seedExtractionDir(),
			originalFilename: "v1.elpx",
			uploadSessionId: sessionId,
		});
		await repo.publishResourceVersion(db(), {
			resourceId,
			elpxProjectId: projectId,
			createdBy: "1",
		});

		const result = await retireUploadArtifacts(db(), sessionId);
		expect(result.retired).toBe(false);
		expect(existsSync(rawPath)).toBe(true);
		const session = await repo.getUploadSessionById(db(), sessionId);
		expect(session?.status).toBe("created");
	});
});
