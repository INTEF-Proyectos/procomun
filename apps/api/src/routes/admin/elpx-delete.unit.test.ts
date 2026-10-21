import { describe, expect, test } from "bun:test";
import * as repo from "@procomun/db/repository";
import { Hono } from "hono";
import type { AuthEnv } from "../../auth/middleware.ts";
import { getDb } from "../../db.ts";
import { adminRoutes } from "./index.ts";

function createAdminApp(mockUser: Record<string, unknown> | null = null) {
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

async function setupUser(id: string, role: string) {
	await repo.ensureUser(getDb().db, {
		id,
		email: `${id}@local.invalid`,
		name: `User ${id}`,
		role,
	});
	return createAdminApp({
		id,
		role,
		email: `${id}@local.invalid`,
		name: `User ${id}`,
	});
}

const db = () => getDb().db;

function uniqueHash() {
	return (
		crypto.randomUUID().replaceAll("-", "") +
		crypto.randomUUID().replaceAll("-", "")
	);
}

async function createOwnedResource(
	app: ReturnType<typeof createAdminApp>,
	title: string,
) {
	const res = await app.request("/api/admin/resources", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			title,
			description: "Recurso con ODE para borrar",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			author: "Autora de prueba",
		}),
	});
	expect(res.status).toBe(201);
	return (await res.json()) as { id: string; title: string };
}

async function attachOde(
	resourceId: string,
	filename: string,
	options?: { versioned?: boolean; createdBy?: string },
) {
	const hash = uniqueHash();
	const { id } = await repo.createElpxProject(db(), {
		resourceId,
		hash,
		extractPath: `/tmp/procomun-delete-ode-${hash}`,
		originalFilename: filename,
		hasPreview: true,
	});
	if (options?.versioned) {
		await repo.publishResourceVersion(db(), {
			resourceId,
			elpxProjectId: id,
			createdBy: options.createdBy ?? "1",
		});
	}
	await repo.createMediaItem(db(), {
		resourceId,
		type: "file",
		mimeType: "application/zip",
		url: `/api/v1/uploads/${id}/content`,
		filename,
		isPrimary: true,
	});
	await repo.createMediaItem(db(), {
		resourceId,
		type: "file",
		mimeType: "application/pdf",
		url: "/files/guia.pdf",
		filename: "guia.pdf",
		isPrimary: false,
	});
	return { id, hash };
}

describe("DELETE /api/admin/elpx/:resourceId (issue #393)", () => {
	test("un author retira el ODE sin borrar la ficha y la previsualización desaparece", async () => {
		const ownerId = `ode-owner-${crypto.randomUUID()}`;
		const app = await setupUser(ownerId, "author");
		const resource = await createOwnedResource(app, "ODE del autor");
		await attachOde(resource.id, "fracciones.elpx");

		const res = await app.request(`/api/admin/elpx/${resource.id}`, {
			method: "DELETE",
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.retired).toBe(true);

		const stillThere = await app.request(`/api/admin/resources/${resource.id}`);
		expect(stillThere.status).toBe(200);
		expect((await stillThere.json()).title).toBe("ODE del autor");

		const elpx = await app.request(`/api/admin/resources/${resource.id}/elpx`);
		expect(elpx.status).toBe(404);
		expect(await repo.getElpxProjectByResourceId(db(), resource.id)).toBeNull();

		const media = await repo.listMediaItemsForResource(db(), resource.id);
		expect(media.some((item) => item.filename?.endsWith(".elpx"))).toBe(false);
		expect(media.some((item) => item.filename === "guia.pdf")).toBe(true);
	});

	test("si el ODE está versionado deja de ser vigente, conserva el historial y no se publica", async () => {
		const app = createAdminApp({ id: "1", role: "admin" });
		const resource = await createOwnedResource(app, "ODE vigente");
		const { hash, id: projectId } = await attachOde(
			resource.id,
			"vigente.elpx",
			{ versioned: true, createdBy: "1" },
		);
		expect(await repo.isElpxHashHistorical(db(), hash)).toBe(false);

		const res = await app.request(`/api/admin/elpx/${resource.id}`, {
			method: "DELETE",
		});
		expect(res.status).toBe(200);
		expect((await res.json()).ok).toBe(true);

		expect(
			(await app.request(`/api/admin/resources/${resource.id}`)).status,
		).toBe(200);
		expect(
			(await app.request(`/api/admin/resources/${resource.id}/elpx`)).status,
		).toBe(404);
		expect(
			await repo.getCurrentElpxProjectByResourceId(db(), resource.id),
		).toBe(null);
		expect(await repo.isElpxHashHistorical(db(), hash)).toBe(true);
		expect(
			await repo.listElpxProjectsByResourceIds(db(), [resource.id]),
		).toEqual([]);

		const history = await repo.listResourceVersions(db(), resource.id);
		expect(history.some((version) => version.elpxProjectId === projectId)).toBe(
			true,
		);
		expect(history.every((version) => version.isCurrent === false)).toBe(true);
		expect(await repo.getElpxProjectByResourceId(db(), resource.id)).not.toBe(
			null,
		);
	});

	test("un author ajeno, un reader y un anónimo no pueden borrar el ODE", async () => {
		const ownerId = `ode-owner-${crypto.randomUUID()}`;
		const ownerApp = await setupUser(ownerId, "author");
		const resource = await createOwnedResource(ownerApp, "ODE ajeno");
		const { id: projectId } = await attachOde(resource.id, "privado.elpx");

		const intruder = await setupUser(
			`ode-intruder-${crypto.randomUUID()}`,
			"author",
		);
		expect(
			(
				await intruder.request(`/api/admin/elpx/${resource.id}`, {
					method: "DELETE",
				})
			).status,
		).toBe(403);

		const reader = createAdminApp({ id: "reader-ode", role: "reader" });
		expect(
			(
				await reader.request(`/api/admin/elpx/${resource.id}`, {
					method: "DELETE",
				})
			).status,
		).toBe(403);

		const anonymous = createAdminApp(null);
		expect(
			(
				await anonymous.request(`/api/admin/elpx/${resource.id}`, {
					method: "DELETE",
				})
			).status,
		).toBe(401);

		expect((await repo.getElpxProjectByResourceId(db(), resource.id))?.id).toBe(
			projectId,
		);
	});

	test("404 si no hay recurso o no hay ODE", async () => {
		const app = createAdminApp({ id: "1", role: "admin" });
		expect(
			(await app.request("/api/admin/elpx/no-existe", { method: "DELETE" }))
				.status,
		).toBe(404);

		const resource = await createOwnedResource(app, "Sin ODE");
		expect(
			(
				await app.request(`/api/admin/elpx/${resource.id}`, {
					method: "DELETE",
				})
			).status,
		).toBe(404);
		expect(
			(await app.request(`/api/admin/resources/${resource.id}`)).status,
		).toBe(200);
	});
});
