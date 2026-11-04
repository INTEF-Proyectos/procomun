import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as repo from "@procomun/db/repository";
import { resources } from "@procomun/db/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthEnv } from "../../auth/middleware.ts";
import { getDb } from "../../db.ts";
import { elpxAdminRoutes } from "./elpx.ts";

const FIXTURE = path.resolve(
	import.meta.dir,
	"../../test-fixtures/elpx/really-simple-test-project.elpx",
);

let storageDir: string;
let previousStorageDir: string | undefined;

beforeAll(async () => {
	previousStorageDir = process.env.UPLOAD_STORAGE_DIR;
	storageDir = await mkdtemp(path.join(tmpdir(), "procomun-elpx-versions-"));
	process.env.UPLOAD_STORAGE_DIR = storageDir;
});

afterAll(async () => {
	if (previousStorageDir === undefined) delete process.env.UPLOAD_STORAGE_DIR;
	else process.env.UPLOAD_STORAGE_DIR = previousStorageDir;
	await rm(storageDir, { recursive: true, force: true });
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
	return app;
}

async function seedResource() {
	return repo.createResource(getDb().db, {
		title: "Recurso versionado",
		description: "Historial automático",
		language: "es",
		license: "cc-by",
		resourceType: "documento",
		createdBy: "1",
	});
}

async function uploadFixture(
	app: ReturnType<typeof createApp>,
	resourceId: string,
) {
	const form = new FormData();
	form.append(
		"file",
		new File([readFileSync(FIXTURE)], "nueva-entrega.elpx", {
			type: "application/zip",
		}),
	);
	return app.request(`/api/admin/elpx/upload/${resourceId}`, {
		method: "POST",
		body: form,
	});
}

async function seedWorkingProject(resourceId: string) {
	const extractPath = await mkdtemp(path.join(tmpdir(), "procomun-working-"));
	await writeFile(path.join(extractPath, "index.html"), "working copy");
	const project = await repo.createElpxProject(getDb().db, {
		resourceId,
		hash: crypto.randomUUID(),
		extractPath,
		originalFilename: "working.elpx",
	});
	return { ...project, extractPath };
}

describe("automatic ELPX versioning", () => {
	test("uploading an ELPX creates v1 and makes it current", async () => {
		const app = createApp();
		const { id } = await seedResource();

		const res = await uploadFixture(app, id);
		expect(res.status).toBe(200);

		const history = await repo.listResourceVersions(getDb().db, id);
		expect(history).toHaveLength(1);
		expect(history[0]?.versionNumber).toBe(1);
		expect(history[0]?.isCurrent).toBe(true);
	});

	test("a new upload creates the next version and preserves the previous ELPX", async () => {
		const app = createApp();
		const { id } = await seedResource();
		const previous = await seedWorkingProject(id);
		const first = await repo.publishResourceVersion(getDb().db, {
			resourceId: id,
			elpxProjectId: previous.id,
			createdBy: "1",
		});

		const res = await uploadFixture(app, id);
		expect(res.status).toBe(200);

		const history = await repo.listResourceVersions(getDb().db, id);
		expect(history).toHaveLength(2);
		expect(history[0]?.versionNumber).toBe(2);
		expect(history[0]?.isCurrent).toBe(true);
		expect(history[1]?.id).toBe(first.id);
		expect(history[1]?.elpxProjectId).toBe(previous.id);
		expect(existsSync(previous.extractPath)).toBe(true);
	});

	test("an unversioned working copy is retired when the uploaded ELPX becomes v1", async () => {
		const app = createApp();
		const { id } = await seedResource();
		const previous = await seedWorkingProject(id);

		const res = await uploadFixture(app, id);
		expect(res.status).toBe(200);

		const history = await repo.listResourceVersions(getDb().db, id);
		expect(history).toHaveLength(1);
		expect(history[0]?.versionNumber).toBe(1);
		expect(history[0]?.elpxProjectId).not.toBe(previous.id);
		expect(existsSync(previous.extractPath)).toBe(false);
	});
});

describe("POST /api/admin/elpx/generate/:resourceId", () => {
	test("un recurso sin idioma no recibe español en el paquete generado (#473)", async () => {
		const app = createApp();
		const { id } = await seedResource();
		await getDb()
			.db.update(resources)
			.set({ language: null })
			.where(eq(resources.id, id));

		const res = await app.request(`/api/admin/elpx/generate/${id}`, {
			method: "POST",
		});
		expect(res.status).toBe(200);

		const project = await repo.getElpxProjectByResourceId(getDb().db, id);
		const metadata = project?.elpxMetadata as { language?: string } | null;
		expect(metadata?.language).toBe("");
	});
});
