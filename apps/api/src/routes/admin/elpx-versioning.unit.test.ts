import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as repo from "@procomun/db/repository";
import { Hono } from "hono";
import type { AuthEnv } from "../../auth/middleware.ts";
import { getDb } from "../../db.ts";
import {
	getUploadConfig,
	resolveStoredFilePath,
} from "../../uploads/config.ts";
import { publicRoutes } from "../public.ts";
import { elpxAdminRoutes } from "./elpx.ts";

const FIXTURES_DIR = path.resolve(import.meta.dir, "../../test-fixtures/elpx");
const FIXTURE = path.join(FIXTURES_DIR, "really-simple-test-project.elpx");

let storageDir: string;
let previousStorageDir: string | undefined;

beforeAll(async () => {
	previousStorageDir = process.env.UPLOAD_STORAGE_DIR;
	storageDir = await mkdtemp(path.join(tmpdir(), "procomun-elpx-versions-"));
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

function createApp() {
	const app = new Hono<AuthEnv>();
	app.use("*", async (c, next) => {
		c.set("user", {
			id: "1",
			role: "author",
			name: "Autora",
		} as AuthEnv["Variables"]["user"]);
		c.set("session", { id: "s" } as AuthEnv["Variables"]["session"]);
		await next();
	});
	app.route("/api/admin/elpx", elpxAdminRoutes);
	app.route("/api/v1", publicRoutes);
	return app;
}

const db = () => getDb().db;

async function seedResource() {
	const { id, slug } = await repo.createResource(db(), {
		title: "Recurso versionado",
		description: "Protección de historial",
		language: "es",
		license: "cc-by",
		resourceType: "documento",
		createdBy: "1",
	});
	return { id, slug };
}

async function seedCompletedSession(resourceId: string, content: string) {
	const sessionId = crypto.randomUUID();
	await repo.createUploadSession(db(), {
		id: sessionId,
		resourceId,
		ownerId: "1",
		originalFilename: "v1.elpx",
		mimeType: "application/zip",
		storageKey: `resource/${resourceId}/${sessionId}/v1.elpx`,
		declaredSize: content.length,
		expiresAt: null,
	});
	const media = await repo.createMediaItem(db(), {
		resourceId,
		type: "file",
		mimeType: "application/zip",
		url: `/api/v1/uploads/${sessionId}/content`,
		fileSize: content.length,
		filename: "v1.elpx",
		isPrimary: true,
	});
	await repo.completeUploadSession(db(), sessionId, {
		receivedBytes: content.length,
		publicUrl: `/api/v1/uploads/${sessionId}/content`,
		mediaItemId: media.id,
		finalChecksum: "b2".repeat(32),
	});
	const rawPath = resolveStoredFilePath(getUploadConfig(), sessionId);
	await mkdir(path.dirname(rawPath), { recursive: true });
	await writeFile(rawPath, content);
	return { sessionId, mediaItemId: media.id };
}

async function seedExtractionDir() {
	const dir = await mkdtemp(path.join(tmpdir(), "procomun-extract-"));
	await writeFile(path.join(dir, "index.html"), "<html>v1</html>");
	return dir;
}

async function uploadFixture(app: ReturnType<typeof createApp>, id: string) {
	const buf = readFileSync(FIXTURE);
	const form = new FormData();
	form.append(
		"file",
		new File([buf], "nueva-entrega.elpx", { type: "application/zip" }),
	);
	return app.request(`/api/admin/elpx/upload/${id}`, {
		method: "POST",
		body: form,
	});
}

async function listProjects(resourceId: string) {
	const { elpxProjects } = await import("@procomun/db/schema");
	const { eq } = await import("drizzle-orm");
	return db()
		.select()
		.from(elpxProjects)
		.where(eq(elpxProjects.resourceId, resourceId));
}

describe("Reemplazo de .elpx con historial de versiones (issue #31)", () => {
	test("conserva el proyecto y la extracción de una versión publicada", async () => {
		const app = createApp();
		const { id: resourceId } = await seedResource();
		const extractPath = await seedExtractionDir();
		const { id: publishedProject } = await repo.createElpxProject(db(), {
			resourceId,
			hash: crypto.randomUUID(),
			extractPath,
			originalFilename: "v1.elpx",
		});
		await repo.publishResourceVersion(db(), {
			resourceId,
			elpxProjectId: publishedProject,
			createdBy: "1",
		});

		const res = await uploadFixture(app, resourceId);
		expect(res.status).toBe(200);

		const projects = await listProjects(resourceId);
		expect(projects).toHaveLength(2);
		expect(projects.some((p) => p.id === publishedProject)).toBe(true);
		expect(existsSync(extractPath)).toBe(true);

		const history = await repo.listResourceVersions(db(), resourceId);
		expect(history[0]?.elpxProjectId).toBe(publishedProject);
	});

	test("sigue reemplazando la copia de trabajo sin publicar", async () => {
		const app = createApp();
		const { id: resourceId } = await seedResource();
		const extractPath = await seedExtractionDir();
		await repo.createElpxProject(db(), {
			resourceId,
			hash: crypto.randomUUID(),
			extractPath,
			originalFilename: "borrador.elpx",
		});

		const res = await uploadFixture(app, resourceId);
		expect(res.status).toBe(200);

		const projects = await listProjects(resourceId);
		expect(projects).toHaveLength(1);
		expect(existsSync(extractPath)).toBe(false);
	});

	test("no borra el archivo crudo ni cancela la sesión de una versión publicada", async () => {
		const app = createApp();
		const { id: resourceId } = await seedResource();
		const sessionId = crypto.randomUUID();
		await repo.createUploadSession(db(), {
			id: sessionId,
			resourceId,
			ownerId: "1",
			originalFilename: "v1.elpx",
			mimeType: "application/zip",
			storageKey: `resource/${resourceId}/${sessionId}/v1.elpx`,
			declaredSize: 4,
			expiresAt: null,
		});
		const media = await repo.createMediaItem(db(), {
			resourceId,
			type: "file",
			mimeType: "application/zip",
			url: `/api/v1/uploads/${sessionId}/content`,
			fileSize: 4,
			filename: "v1.elpx",
			isPrimary: true,
		});
		await repo.completeUploadSession(db(), sessionId, {
			receivedBytes: 4,
			publicUrl: `/api/v1/uploads/${sessionId}/content`,
			mediaItemId: media.id,
			finalChecksum: "a1".repeat(32),
		});

		const config = getUploadConfig();
		const rawPath = resolveStoredFilePath(config, sessionId);
		await mkdir(path.dirname(rawPath), { recursive: true });
		await writeFile(rawPath, "PKv1");

		const extractPath = await seedExtractionDir();
		const { id: publishedProject } = await repo.createElpxProject(db(), {
			resourceId,
			hash: crypto.randomUUID(),
			extractPath,
			originalFilename: "v1.elpx",
			uploadSessionId: sessionId,
		});
		await repo.publishResourceVersion(db(), {
			resourceId,
			elpxProjectId: publishedProject,
			createdBy: "1",
		});

		const res = await uploadFixture(app, resourceId);
		expect(res.status).toBe(200);

		// El archivo crudo de la versión publicada sobrevive y la sesión sigue
		// completada: es la fuente de descarga del historial (RF-006).
		expect(existsSync(rawPath)).toBe(true);
		const session = await repo.getUploadSessionById(db(), sessionId);
		expect(session?.status).toBe("completed");
	});
});

describe("Ficha pública y descargas con versionado (issue #31)", () => {
	test("la ficha pública sirve la previsualización y descarga de la versión vigente", async () => {
		const app = createApp();
		const { id: resourceId, slug } = await seedResource();
		await repo.updateEditorialStatus(db(), resourceId, "published", "1");

		const { sessionId } = await seedCompletedSession(resourceId, "PKv1");
		const publishedHash = crypto.randomUUID();
		const { id: publishedProject } = await repo.createElpxProject(db(), {
			resourceId,
			hash: publishedHash,
			extractPath: await seedExtractionDir(),
			originalFilename: "v1.elpx",
			uploadSessionId: sessionId,
			hasPreview: true,
		});
		const { elpxProjects } = await import("@procomun/db/schema");
		const { eq } = await import("drizzle-orm");
		await db()
			.update(elpxProjects)
			.set({ createdAt: new Date(Date.now() - 60_000) })
			.where(eq(elpxProjects.id, publishedProject));
		await repo.publishResourceVersion(db(), {
			resourceId,
			elpxProjectId: publishedProject,
			createdBy: "1",
		});

		// Copia de trabajo posterior sin publicar
		await repo.createElpxProject(db(), {
			resourceId,
			hash: crypto.randomUUID(),
			extractPath: await seedExtractionDir(),
			originalFilename: "borrador.elpx",
			hasPreview: true,
		});

		const res = await app.request(`/api/v1/resources/${slug}`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			elpxPreview: { hash: string } | null;
			elpxFileUrl: string | null;
		};
		expect(body.elpxPreview?.hash).toBe(publishedHash);
		expect(body.elpxFileUrl).toBe(`/api/v1/uploads/${sessionId}/content`);
	});

	test("la descarga pública de una versión sobrevive al borrado de su media item", async () => {
		const app = createApp();
		const { id: resourceId } = await seedResource();
		await repo.updateEditorialStatus(db(), resourceId, "published", "1");

		const { sessionId, mediaItemId } = await seedCompletedSession(
			resourceId,
			"PKv1-contenido",
		);
		const { id: publishedProject } = await repo.createElpxProject(db(), {
			resourceId,
			hash: crypto.randomUUID(),
			extractPath: await seedExtractionDir(),
			originalFilename: "v1.elpx",
			uploadSessionId: sessionId,
		});
		await repo.publishResourceVersion(db(), {
			resourceId,
			elpxProjectId: publishedProject,
			createdBy: "1",
		});

		// Reemplazo: el media item desaparece (upload_sessions.media_item_id → null)
		await repo.deleteMediaItem(db(), mediaItemId);

		const res = await app.request(`/api/v1/uploads/${sessionId}/content`);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("PKv1-contenido");
	});

	test("una sesión sin media item ni versión asociada no es descargable", async () => {
		const app = createApp();
		const { id: resourceId } = await seedResource();
		await repo.updateEditorialStatus(db(), resourceId, "published", "1");

		const { sessionId, mediaItemId } = await seedCompletedSession(
			resourceId,
			"PKhuérfano",
		);
		await repo.deleteMediaItem(db(), mediaItemId);

		const res = await app.request(`/api/v1/uploads/${sessionId}/content`);
		expect(res.status).toBe(404);
	});
});
