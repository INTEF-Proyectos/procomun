import { describe, expect, test } from "bun:test";
import * as repo from "@procomun/db/repository";
import { Hono } from "hono";
import type { AuthEnv } from "../../auth/middleware.ts";
import { getDb } from "../../db.ts";
import { adminRoutes } from "./index.ts";

function createApp(mockUser: Record<string, unknown> | null = null) {
	const app = new Hono<AuthEnv>();
	app.use("*", async (c, next) => {
		c.set("user", mockUser as AuthEnv["Variables"]["user"]);
		c.set(
			"session",
			mockUser ? ({ id: "s" } as AuthEnv["Variables"]["session"]) : null,
		);
		await next();
	});
	app.route("/api/admin", adminRoutes);
	return app;
}

const authorApp = createApp({ id: "1", role: "author", name: "Autora" });
const curatorApp = createApp({ id: "1", role: "curator", name: "Curadora" });

async function seedResource() {
	return repo.createResource(getDb().db, {
		title: "Recurso con versiones",
		description: "Recurso para tests de versionado",
		language: "es",
		license: "cc-by",
		resourceType: "documento",
		createdBy: "1",
	});
}

// Hash único por llamada. La base PGlite en memoria es una sola para toda la
// ejecución de `bun test` y `elpx_projects.hash` es UNIQUE: con literales como
// "b".repeat(64), que elpx-processor.unit.test.ts también registra, el test
// fallaba o no según el orden en que bun ejecutase los ficheros.
function uniqueHash() {
	return new Bun.CryptoHasher("sha256")
		.update(crypto.randomUUID())
		.digest("hex");
}

async function seedVersion(resourceId: string, hash = uniqueHash()) {
	const { id: elpxProjectId } = await repo.createElpxProject(getDb().db, {
		resourceId,
		hash,
		extractPath: `/tmp/${crypto.randomUUID()}`,
		originalFilename: `recurso-${hash.slice(0, 6)}.elpx`,
		hasPreview: true,
	});
	const version = await repo.publishResourceVersion(getDb().db, {
		resourceId,
		elpxProjectId,
		createdBy: "1",
	});
	return { ...version, elpxProjectId };
}

describe("resource version admin API", () => {
	test("there is no manual endpoint to publish a version", async () => {
		const { id } = await seedResource();
		const res = await authorApp.request(`/api/admin/resources/${id}/versions`, {
			method: "POST",
		});
		expect(res.status).toBe(404);
	});

	test("lists immutable history without change notes", async () => {
		const { id } = await seedResource();
		await seedVersion(id);
		const currentHash = uniqueHash();
		await seedVersion(id, currentHash);

		const res = await authorApp.request(`/api/admin/resources/${id}/versions`);
		expect(res.status).toBe(200);
		const history = (await res.json()) as Array<Record<string, unknown>>;
		expect(history).toHaveLength(2);
		expect(history[0]?.versionNumber).toBe(2);
		expect(history[0]?.isCurrent).toBe(true);
		expect(history[1]?.versionNumber).toBe(1);
		expect(history[1]?.previewUrl).toBe(
			`/api/admin/resources/${id}/versions/${history[1]?.id}/preview/`,
		);
		// El recurso es un borrador: la versión vigente lleva enlace firmado (#466).
		expect(String(history[0]?.previewUrl)).toStartWith(
			`/api/v1/elpx/preview/${currentHash}/`,
		);
		expect("changeNotes" in (history[0] ?? {})).toBe(false);
	});

	test("curator restores by creating a new current version", async () => {
		const { id } = await seedResource();
		const first = await seedVersion(id);
		await seedVersion(id);

		const forbidden = await authorApp.request(
			`/api/admin/resources/${id}/versions/${first.id}/restore`,
			{ method: "POST" },
		);
		expect(forbidden.status).toBe(403);

		const res = await curatorApp.request(
			`/api/admin/resources/${id}/versions/${first.id}/restore`,
			{ method: "POST" },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			versionNumber: number;
			restoredFromVersionNumber: number;
		};
		expect(body.versionNumber).toBe(3);
		expect(body.restoredFromVersionNumber).toBe(1);

		const history = await repo.listResourceVersions(getDb().db, id);
		expect(history).toHaveLength(3);
		expect(history[0]?.elpxProjectId).toBe(first.elpxProjectId);
		expect(history[0]?.isCurrent).toBe(true);

		const editorElpx = await curatorApp.request(
			`/api/admin/resources/${id}/elpx`,
		);
		expect(editorElpx.status).toBe(200);
		expect((await editorElpx.json()).id).toBe(first.elpxProjectId);
	});
});
