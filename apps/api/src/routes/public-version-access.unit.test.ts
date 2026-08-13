import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as repo from "@procomun/db/repository";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { getDb } from "../db.ts";
import { app } from "../index.ts";
import { adminRoutes } from "./admin/index.ts";

function createAdminApp(mockUser: Record<string, unknown> | null = null) {
	const adminApp = new Hono<AuthEnv>();
	adminApp.use("*", async (c, next) => {
		c.set("user", mockUser as AuthEnv["Variables"]["user"]);
		c.set(
			"session",
			mockUser ? ({ id: "s" } as AuthEnv["Variables"]["session"]) : null,
		);
		await next();
	});
	adminApp.route("/api/admin", adminRoutes);
	return adminApp;
}

const authorApp = createAdminApp({ id: "1", role: "author", name: "Autora" });
const strangerApp = createAdminApp({
	id: "stranger",
	role: "author",
	name: "Otra",
});

const originalStorageDir = process.env.UPLOAD_STORAGE_DIR;
let tmpRoot = "";
let resourceId = "";
let historicalVersionId = "";
let historicalUploadId = "";
let currentUploadId = "";
let historicalHash = "";
let currentHash = "";

async function seedCompletedUpload(
	uploadId: string,
	resource: string,
	filename: string,
	body: string,
) {
	await writeFile(path.join(tmpRoot, uploadId), body);
	await repo.createUploadSession(getDb().db, {
		id: uploadId,
		resourceId: resource,
		ownerId: "1",
		originalFilename: filename,
		mimeType: "application/zip",
		storageKey: `resource/${resource}/${uploadId}/${filename}`,
		declaredSize: body.length,
	});
	const media = await repo.createMediaItem(getDb().db, {
		resourceId: resource,
		type: "file",
		mimeType: "application/zip",
		url: `/api/v1/uploads/${uploadId}/content`,
		fileSize: body.length,
		filename,
	});
	await repo.completeUploadSession(getDb().db, uploadId, {
		receivedBytes: body.length,
		publicUrl: `/api/v1/uploads/${uploadId}/content`,
		mediaItemId: media.id,
		finalChecksum: `checksum-${uploadId}`,
	});
	// Tras reemplazar el ELPX el media item se elimina; la sesión queda
	// referenciada solo por resource_versions (issue #323).
	await repo.deleteMediaItem(getDb().db, media.id);
}

async function seedExtract(hash: string, title: string) {
	const dir = path.join(tmpRoot, "elpx", hash);
	await mkdir(dir, { recursive: true });
	await writeFile(
		path.join(dir, "index.html"),
		`<!doctype html><html><head><title>${title}</title></head><body><h1>${title}</h1><link rel="stylesheet" href="style.css"></body></html>`,
	);
	await writeFile(path.join(dir, "style.css"), "h1{color:navy}");
}

beforeAll(async () => {
	tmpRoot = await mkdtemp(path.join(tmpdir(), "public-version-access-"));
	process.env.UPLOAD_STORAGE_DIR = tmpRoot;

	await repo.ensureUser(getDb().db, {
		id: "stranger",
		email: "stranger@test.com",
		name: "Otra",
		role: "author",
	});

	const resource = await repo.createResource(getDb().db, {
		title: "Recurso con historial público",
		description: "Versiones históricas no deben ser públicas",
		language: "es",
		license: "cc-by",
		resourceType: "actividad-interactiva",
		createdBy: "1",
	});
	resourceId = resource.id;
	await repo.updateEditorialStatus(
		getDb().db,
		resourceId,
		"published",
		"system",
	);

	historicalUploadId = `hist-elpx-${crypto.randomUUID()}`;
	currentUploadId = `curr-elpx-${crypto.randomUUID()}`;
	historicalHash = crypto.randomUUID().replaceAll("-", "").padEnd(40, "a");
	currentHash = crypto.randomUUID().replaceAll("-", "").padEnd(40, "b");

	await seedCompletedUpload(
		historicalUploadId,
		resourceId,
		"historico.elpx",
		"elpx historico",
	);
	await seedExtract(historicalHash, "Historico");
	const historicalProject = await repo.createElpxProject(getDb().db, {
		resourceId,
		hash: historicalHash,
		extractPath: path.join(tmpRoot, "elpx", historicalHash),
		originalFilename: "historico.elpx",
		uploadSessionId: historicalUploadId,
		hasPreview: true,
	});
	const historicalVersion = await repo.publishResourceVersion(getDb().db, {
		resourceId,
		elpxProjectId: historicalProject.id,
		createdBy: "1",
	});
	historicalVersionId = historicalVersion.id;

	await seedCompletedUpload(
		currentUploadId,
		resourceId,
		"vigente.elpx",
		"elpx vigente",
	);
	await seedExtract(currentHash, "Vigente");
	const currentProject = await repo.createElpxProject(getDb().db, {
		resourceId,
		hash: currentHash,
		extractPath: path.join(tmpRoot, "elpx", currentHash),
		originalFilename: "vigente.elpx",
		uploadSessionId: currentUploadId,
		hasPreview: true,
	});
	await repo.publishResourceVersion(getDb().db, {
		resourceId,
		elpxProjectId: currentProject.id,
		createdBy: "1",
	});
});

afterAll(async () => {
	if (originalStorageDir === undefined) {
		delete process.env.UPLOAD_STORAGE_DIR;
	} else {
		process.env.UPLOAD_STORAGE_DIR = originalStorageDir;
	}
	if (tmpRoot) {
		await rm(tmpRoot, { recursive: true, force: true });
	}
});

describe("acceso público a versiones históricas (issue #323)", () => {
	test("la descarga pública de una versión que deja de ser vigente devuelve 404", async () => {
		const res = await app.request(
			`/api/v1/uploads/${historicalUploadId}/content`,
		);
		expect(res.status).toBe(404);
	});

	test("la versión vigente de un recurso publicado sigue descargándose", async () => {
		const res = await app.request(`/api/v1/uploads/${currentUploadId}/content`);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("elpx vigente");
	});

	test("el hash público de una versión histórica no sirve su contenido", async () => {
		const res = await app.request(`/api/v1/elpx/${historicalHash}/`);
		expect(res.status).toBe(404);
	});

	test("el hash de la versión vigente sigue previsualizándose públicamente", async () => {
		const res = await app.request(`/api/v1/elpx/${currentHash}/`);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("Vigente");
		expect(res.headers.get("content-security-policy")).toContain("sandbox");
		expect(res.headers.get("content-security-policy")).not.toContain(
			"allow-same-origin",
		);
	});

	test("la versión histórica se descarga desde administración", async () => {
		const res = await authorApp.request(
			`/api/admin/uploads/${historicalUploadId}/content`,
		);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("elpx historico");
	});

	test("la versión histórica se previsualiza desde un endpoint autenticado", async () => {
		const previewPath = `/api/admin/resources/${resourceId}/versions/${historicalVersionId}/preview/`;
		const res = await authorApp.request(previewPath);
		expect(res.status).toBe(200);
		const html = await res.text();
		expect(html).toContain("Historico");
		expect(html).toContain(previewPath);
		expect(res.headers.get("content-security-policy")).toContain("sandbox");
		expect(res.headers.get("content-security-policy")).not.toContain(
			"allow-same-origin",
		);

		const css = await authorApp.request(`${previewPath}style.css`);
		expect(css.status).toBe(200);
		expect(css.headers.get("content-security-policy")).toContain("sandbox");
	});

	test("un usuario sin permiso no previsualiza versiones históricas", async () => {
		const res = await strangerApp.request(
			`/api/admin/resources/${resourceId}/versions/${historicalVersionId}/preview/`,
		);
		expect(res.status).toBe(403);
	});

	test("el listado de historial apunta la previsualización histórica al endpoint admin", async () => {
		const res = await authorApp.request(
			`/api/admin/resources/${resourceId}/versions`,
		);
		expect(res.status).toBe(200);
		const history = (await res.json()) as Array<{
			isCurrent: boolean;
			previewUrl: string | null;
			id: string;
		}>;
		const historical = history.find((version) => !version.isCurrent);
		expect(historical?.previewUrl).toBe(
			`/api/admin/resources/${resourceId}/versions/${historicalVersionId}/preview/`,
		);
		const current = history.find((version) => version.isCurrent);
		expect(current?.previewUrl).toBe(`/api/v1/elpx/${currentHash}/`);
	});
});
