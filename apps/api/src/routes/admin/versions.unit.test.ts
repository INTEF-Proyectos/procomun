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
const otherAuthorApp = createApp({ id: "2", role: "author", name: "Otra" });
const anonApp = createApp(null);

const validResource = {
	title: "Recurso con versiones",
	description: "Recurso para tests de versionado",
	language: "es",
	license: "cc-by",
	resourceType: "documento",
};

async function createResource(app: ReturnType<typeof createApp>) {
	const res = await app.request("/api/admin/resources", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(validResource),
	});
	expect(res.status).toBe(201);
	return (await res.json()) as { id: string; slug: string };
}

async function seedElpxProject(
	resourceId: string,
	opts: { withSession?: boolean } = {},
) {
	const db = getDb().db;
	let uploadSessionId: string | null = null;
	if (opts.withSession) {
		uploadSessionId = crypto.randomUUID();
		await repo.createUploadSession(db, {
			id: uploadSessionId,
			resourceId,
			ownerId: "1",
			originalFilename: "recurso.elpx",
			mimeType: "application/zip",
			storageKey: `resource/${resourceId}/${uploadSessionId}/recurso.elpx`,
			finalChecksum: "f".repeat(64),
			declaredSize: 10,
			expiresAt: null,
		});
	}
	const { id } = await repo.createElpxProject(db, {
		resourceId,
		hash: crypto.randomUUID(),
		extractPath: `/tmp/procomun-test-elpx/${crypto.randomUUID()}`,
		originalFilename: "recurso.elpx",
		uploadSessionId,
	});
	return { projectId: id, uploadSessionId };
}

function publishVersion(
	app: ReturnType<typeof createApp>,
	resourceId: string,
	body: Record<string, unknown> = {},
) {
	return app.request(`/api/admin/resources/${resourceId}/versions`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("POST /api/admin/resources/:id/versions — publicar", () => {
	test("publica la primera versión desde la copia de trabajo", async () => {
		const { id } = await createResource(authorApp);
		await seedElpxProject(id);

		const res = await publishVersion(authorApp, id, {
			changeNotes: "Primera entrega",
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as { id: string; versionNumber: number };
		expect(body.versionNumber).toBe(1);
		expect(body.id).toBeDefined();
	});

	test("409 si la copia de trabajo ya está publicada como versión", async () => {
		const { id } = await createResource(authorApp);
		await seedElpxProject(id);
		await publishVersion(authorApp, id);

		const res = await publishVersion(authorApp, id);
		expect(res.status).toBe(409);
	});

	test("publica una segunda versión tras subir una nueva entrega", async () => {
		const { id } = await createResource(authorApp);
		await seedElpxProject(id);
		await publishVersion(authorApp, id);
		await seedElpxProject(id);

		const res = await publishVersion(authorApp, id, {
			changeNotes: "Corrige erratas",
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as { versionNumber: number };
		expect(body.versionNumber).toBe(2);
	});

	test("404 si el recurso no tiene proyecto eXeLearning", async () => {
		const { id } = await createResource(authorApp);
		const res = await publishVersion(authorApp, id);
		expect(res.status).toBe(404);
	});

	test("403 para un autor que no gestiona el recurso", async () => {
		const { id } = await createResource(authorApp);
		await seedElpxProject(id);
		const res = await publishVersion(otherAuthorApp, id);
		expect(res.status).toBe(403);
	});

	test("401 sin autenticación", async () => {
		const { id } = await createResource(authorApp);
		const res = await publishVersion(anonApp, id);
		expect(res.status).toBe(401);
	});
});

describe("GET /api/admin/resources/:id/versions — historial", () => {
	test("devuelve el historial con vigente, notas y descarga", async () => {
		const { id } = await createResource(authorApp);
		const { uploadSessionId } = await seedElpxProject(id, {
			withSession: true,
		});
		await publishVersion(authorApp, id, { changeNotes: "v1" });
		await seedElpxProject(id);
		await publishVersion(authorApp, id, { changeNotes: "v2" });

		const res = await authorApp.request(`/api/admin/resources/${id}/versions`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Array<Record<string, unknown>>;
		expect(body).toHaveLength(2);
		expect(body[0]?.versionNumber).toBe(2);
		expect(body[0]?.isCurrent).toBe(true);
		expect(body[0]?.changeNotes).toBe("v2");
		expect(body[1]?.versionNumber).toBe(1);
		expect(body[1]?.isCurrent).toBe(false);
		expect(body[1]?.downloadUrl).toBe(
			`/api/admin/uploads/${uploadSessionId}/content`,
		);
		expect(body[1]?.createdByName).toBeDefined();
	});

	test("historial vacío para un recurso sin versiones", async () => {
		const { id } = await createResource(authorApp);
		const res = await authorApp.request(`/api/admin/resources/${id}/versions`);
		expect(res.status).toBe(200);
		expect((await res.json()) as unknown[]).toHaveLength(0);
	});
});

describe("POST /api/admin/resources/:id/versions/:versionId/restore", () => {
	async function resourceWithTwoVersions() {
		const { id } = await createResource(authorApp);
		await seedElpxProject(id);
		const first = await publishVersion(authorApp, id, { changeNotes: "v1" });
		const v1 = (await first.json()) as { id: string };
		await seedElpxProject(id);
		await publishVersion(authorApp, id, { changeNotes: "v2" });
		return { resourceId: id, v1Id: v1.id };
	}

	test("un autor no puede restaurar (requiere curador o admin)", async () => {
		const { resourceId, v1Id } = await resourceWithTwoVersions();
		const res = await authorApp.request(
			`/api/admin/resources/${resourceId}/versions/${v1Id}/restore`,
			{ method: "POST" },
		);
		expect(res.status).toBe(403);
	});

	test("curador restaura creando una versión nueva", async () => {
		const { resourceId, v1Id } = await resourceWithTwoVersions();
		const res = await curatorApp.request(
			`/api/admin/resources/${resourceId}/versions/${v1Id}/restore`,
			{ method: "POST" },
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			versionNumber: number;
			restoredFromVersionNumber: number;
		};
		expect(body.versionNumber).toBe(3);
		expect(body.restoredFromVersionNumber).toBe(1);

		const history = await curatorApp.request(
			`/api/admin/resources/${resourceId}/versions`,
		);
		const rows = (await history.json()) as Array<Record<string, unknown>>;
		expect(rows).toHaveLength(3);
		expect(rows[0]?.changeNotes).toBe("Restaurada desde la versión 1");
	});

	test("404 al restaurar una versión de otro recurso", async () => {
		const { v1Id } = await resourceWithTwoVersions();
		const { id: otherResourceId } = await createResource(authorApp);
		const res = await curatorApp.request(
			`/api/admin/resources/${otherResourceId}/versions/${v1Id}/restore`,
			{ method: "POST" },
		);
		expect(res.status).toBe(404);
	});
});
