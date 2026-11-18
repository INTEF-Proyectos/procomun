import { describe, expect, spyOn, test } from "bun:test";
import * as repo from "@procomun/db/repository";
import { Hono } from "hono";
import type { AuthEnv } from "../../auth/middleware.ts";
import { socialRoutes } from "../social.ts";
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
	app.route("/api/v1", socialRoutes);
	return app;
}

const validResource = {
	title: "Report Test Resource",
	description: "Resource for report tests",
	language: "es",
	license: "cc-by",
	resourceType: "documento",
	author: "Autora de prueba",
	// #448: hace falta un área para enviar a revisión o publicar.
	knowledgeAreaIds: ["matematicas"],
};

async function createPublishedResource(app: ReturnType<typeof createApp>) {
	const res = await app.request("/api/admin/resources", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(validResource),
	});
	const body = (await res.json()) as { id: string; slug: string };

	await app.request(`/api/admin/resources/${body.id}/status`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ status: "review" }),
	});
	await app.request(`/api/admin/resources/${body.id}/status`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ status: "published" }),
	});

	return body;
}

const adminApp = createApp({ id: "1", role: "admin", name: "Admin" });
const curatorApp = createApp({ id: "1", role: "curator", name: "Curator" });
const authorApp = createApp({ id: "1", role: "author", name: "Author" });
const anonApp = createApp(null);

describe("Reports — Public submission", () => {
	test("POST /resources/:slug/report → 201 with valid reason", async () => {
		const { slug } = await createPublishedResource(adminApp);
		const res = await adminApp.request(`/api/v1/resources/${slug}/report`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				reason: "spam",
				description: "This is spam content",
			}),
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as { id: string };
		expect(body.id).toBeDefined();
	});

	test("POST /resources/:slug/report → 400 with invalid reason", async () => {
		const { slug } = await createPublishedResource(adminApp);
		const res = await adminApp.request(`/api/v1/resources/${slug}/report`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ reason: "invalid_reason" }),
		});
		expect(res.status).toBe(400);
	});

	test("POST /resources/:slug/report → 401 without auth", async () => {
		const { slug } = await createPublishedResource(adminApp);
		const res = await anonApp.request(`/api/v1/resources/${slug}/report`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ reason: "copyright" }),
		});
		expect(res.status).toBe(401);
	});

	test("POST /resources/:slug/report → 404 non-existent resource", async () => {
		const res = await adminApp.request(
			"/api/v1/resources/no-existe-xyz/report",
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ reason: "spam" }),
			},
		);
		expect(res.status).toBe(404);
	});
});

describe("Reports — Admin management", () => {
	test("GET /api/admin/reports → 200 for curator", async () => {
		const res = await curatorApp.request("/api/admin/reports");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { data: unknown[]; total: number };
		expect(body.data).toBeDefined();
		expect(typeof body.total).toBe("number");
	});

	test("GET /api/admin/reports → 403 for author", async () => {
		const res = await authorApp.request("/api/admin/reports");
		expect(res.status).toBe(403);
	});

	test("GET /api/admin/reports → 401 without auth", async () => {
		const res = await anonApp.request("/api/admin/reports");
		expect(res.status).toBe(401);
	});

	test("Full workflow: submit → list → update status", async () => {
		const { slug } = await createPublishedResource(adminApp);

		// Submit report
		const submitRes = await adminApp.request(
			`/api/v1/resources/${slug}/report`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					reason: "inappropriate",
					description: "Offensive content",
				}),
			},
		);
		expect(submitRes.status).toBe(201);
		const { id: reportId } = (await submitRes.json()) as { id: string };

		// List reports — should contain the new one
		const listRes = await curatorApp.request(
			"/api/admin/reports?status=pending",
		);
		expect(listRes.status).toBe(200);
		const listBody = (await listRes.json()) as {
			data: { id: string }[];
			total: number;
		};
		expect(listBody.data.some((r) => r.id === reportId)).toBe(true);

		// Get report detail
		const detailRes = await curatorApp.request(
			`/api/admin/reports/${reportId}`,
		);
		expect(detailRes.status).toBe(200);
		const detail = (await detailRes.json()) as {
			id: string;
			status: string;
			reason: string;
		};
		expect(detail.status).toBe("pending");
		expect(detail.reason).toBe("inappropriate");

		// Update to in_review
		const updateRes = await curatorApp.request(
			`/api/admin/reports/${reportId}`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "in_review" }),
			},
		);
		expect(updateRes.status).toBe(200);
		const updated = (await updateRes.json()) as {
			status: string;
			moderatorId: string;
		};
		expect(updated.status).toBe("in_review");
		expect(updated.moderatorId).toBe("1");

		// Resolve
		const resolveRes = await curatorApp.request(
			`/api/admin/reports/${reportId}`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					status: "resolved",
					resolution: "Content removed",
					actionTaken: "resource_deactivated",
				}),
			},
		);
		expect(resolveRes.status).toBe(200);
		const resolved = (await resolveRes.json()) as {
			status: string;
			resolvedAt: string;
		};
		expect(resolved.status).toBe("resolved");
		expect(resolved.resolvedAt).toBeDefined();
	});

	test("PATCH /api/admin/reports/:id → 404 for non-existent", async () => {
		const res = await curatorApp.request("/api/admin/reports/non-existent-id", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: "dismissed" }),
		});
		expect(res.status).toBe(404);
	});

	test("la denuncia de un recurso no admite acciones de colección", async () => {
		const { slug } = await createPublishedResource(adminApp);
		const submitRes = await adminApp.request(
			`/api/v1/resources/${slug}/report`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ reason: "spam" }),
			},
		);
		const { id: reportId } = (await submitRes.json()) as { id: string };

		const res = await curatorApp.request(`/api/admin/reports/${reportId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				status: "resolved",
				actionTaken: "collection_deactivated",
			}),
		});
		expect(res.status).toBe(400);
	});

	test("PATCH /api/admin/reports/:id → 400 for invalid status", async () => {
		const { slug } = await createPublishedResource(adminApp);

		const submitRes = await adminApp.request(
			`/api/v1/resources/${slug}/report`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ reason: "broken_link" }),
			},
		);
		const { id: reportId } = (await submitRes.json()) as { id: string };

		const res = await curatorApp.request(`/api/admin/reports/${reportId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ status: "invalid_status" }),
		});
		expect(res.status).toBe(400);
	});
});

// Issue #539: las colecciones se denuncian igual que los recursos y salen en
// la misma cola de moderación.
async function createCollection(
	app: ReturnType<typeof createApp>,
	editorialStatus: "draft" | "published",
) {
	const res = await app.request("/api/admin/collections", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			title: `Colección denunciable ${crypto.randomUUID()}`,
			description: "Colección para probar las denuncias",
			editorialStatus,
		}),
	});
	expect(res.status).toBe(201);
	return (await res.json()) as { id: string; slug: string };
}

async function reportCollection(
	app: ReturnType<typeof createApp>,
	slug: string,
	body: Record<string, unknown>,
) {
	return app.request(`/api/v1/collections/${slug}/report`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("Reports — Colecciones", () => {
	test("POST /collections/:slug/report → 201 con un motivo válido", async () => {
		const { slug } = await createCollection(adminApp, "published");
		const res = await reportCollection(authorApp, slug, {
			reason: "inappropriate",
			description: "La portada es ofensiva",
		});
		expect(res.status).toBe(201);
		expect(((await res.json()) as { id: string }).id).toBeDefined();
	});

	test("POST /collections/:slug/report → 400 con un motivo inválido", async () => {
		const { slug } = await createCollection(adminApp, "published");
		const res = await reportCollection(authorApp, slug, { reason: "nope" });
		expect(res.status).toBe(400);
	});

	test("POST /collections/:slug/report → 401 sin sesión", async () => {
		const { slug } = await createCollection(adminApp, "published");
		const res = await reportCollection(anonApp, slug, { reason: "spam" });
		expect(res.status).toBe(401);
	});

	test("POST /collections/:slug/report → 404 si no existe o no está publicada", async () => {
		const draft = await createCollection(adminApp, "draft");
		expect(
			(await reportCollection(authorApp, draft.slug, { reason: "spam" }))
				.status,
		).toBe(404);
		expect(
			(await reportCollection(authorApp, "no-existe-xyz", { reason: "spam" }))
				.status,
		).toBe(404);
	});

	test("sale en la cola con su colección y se resuelve archivándola", async () => {
		const collection = await createCollection(adminApp, "published");
		const submitRes = await reportCollection(authorApp, collection.slug, {
			reason: "spam",
		});
		const { id: reportId } = (await submitRes.json()) as { id: string };

		const listRes = await curatorApp.request(
			`/api/admin/reports?collectionId=${collection.id}`,
		);
		const list = (await listRes.json()) as {
			data: Array<{
				id: string;
				resourceId: string | null;
				collectionId: string | null;
				collectionTitle: string | null;
				collectionSlug: string | null;
			}>;
			total: number;
		};
		expect(list.total).toBe(1);
		expect(list.data[0]).toMatchObject({
			id: reportId,
			resourceId: null,
			collectionId: collection.id,
			collectionSlug: collection.slug,
		});
		expect(list.data[0]?.collectionTitle).toContain("Colección denunciable");

		// La cola general también la incluye, junto a las de recursos.
		const allRes = await curatorApp.request("/api/admin/reports?limit=100");
		const all = (await allRes.json()) as { data: Array<{ id: string }> };
		expect(all.data.some((r) => r.id === reportId)).toBe(true);

		// Una acción de recurso no vale para una colección.
		const wrong = await curatorApp.request(`/api/admin/reports/${reportId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				status: "resolved",
				actionTaken: "resource_deleted",
			}),
		});
		expect(wrong.status).toBe(400);

		const resolveRes = await curatorApp.request(
			`/api/admin/reports/${reportId}`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					status: "resolved",
					actionTaken: "collection_deactivated",
				}),
			},
		);
		expect(resolveRes.status).toBe(200);
		const resolved = (await resolveRes.json()) as {
			status: string;
			actionTaken: string;
		};
		expect(resolved).toMatchObject({
			status: "resolved",
			actionTaken: "collection_deactivated",
		});

		const after = await adminApp.request(
			`/api/admin/collections/${collection.id}`,
		);
		const archived = (await after.json()) as { editorialStatus: string };
		expect(archived.editorialStatus).toBe("archived");
	});

	test("resolver con collection_deleted borra la colección y su denuncia", async () => {
		const collection = await createCollection(adminApp, "published");
		const submitRes = await reportCollection(authorApp, collection.slug, {
			reason: "copyright",
		});
		const { id: reportId } = (await submitRes.json()) as { id: string };

		const res = await curatorApp.request(`/api/admin/reports/${reportId}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				status: "resolved",
				actionTaken: "collection_deleted",
			}),
		});
		expect(res.status).toBe(200);
		const after = await adminApp.request(
			`/api/admin/collections/${collection.id}`,
		);
		expect(after.status).toBe(404);
	});

	// Review de #585: la colección puede volver a borrador entre la denuncia y
	// su resolución. Otro curator no gestiona ese borrador (#538), tampoco desde
	// la cola de denuncias.
	test("otro curator no actúa sobre una colección que volvió a borrador", async () => {
		const collection = await createCollection(adminApp, "published");
		const submitRes = await reportCollection(authorApp, collection.slug, {
			reason: "spam",
		});
		const { id: reportId } = (await submitRes.json()) as { id: string };

		const toDraft = await adminApp.request(
			`/api/admin/collections/${collection.id}`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ editorialStatus: "draft" }),
			},
		);
		expect(toDraft.status).toBe(200);

		const otherCurator = createApp({
			id: "otro-curator",
			role: "curator",
			name: "Otro curator",
		});
		for (const actionTaken of [
			"collection_deactivated",
			"collection_deleted",
		]) {
			const res = await otherCurator.request(`/api/admin/reports/${reportId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ status: "resolved", actionTaken }),
			});
			expect(res.status).toBe(403);
		}

		const report = await curatorApp.request(`/api/admin/reports/${reportId}`);
		expect(((await report.json()) as { status: string }).status).toBe(
			"pending",
		);
		const after = await adminApp.request(
			`/api/admin/collections/${collection.id}`,
		);
		expect(
			((await after.json()) as { editorialStatus: string }).editorialStatus,
		).toBe("draft");
	});

	// Review de #585: la resolución y la acción van juntas. Si falla la acción,
	// la denuncia no queda resuelta con la colección aún publicada.
	test("si falla la acción, la denuncia conserva su estado", async () => {
		const collection = await createCollection(adminApp, "published");
		const submitRes = await reportCollection(authorApp, collection.slug, {
			reason: "spam",
		});
		const { id: reportId } = (await submitRes.json()) as { id: string };

		const spy = spyOn(repo, "updateCollection").mockImplementation(() => {
			throw new Error("fallo forzado");
		});
		try {
			const res = await curatorApp.request(`/api/admin/reports/${reportId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					status: "resolved",
					actionTaken: "collection_deactivated",
				}),
			});
			expect(res.status).toBe(500);
		} finally {
			spy.mockRestore();
		}

		const report = await curatorApp.request(`/api/admin/reports/${reportId}`);
		const body = (await report.json()) as {
			status: string;
			actionTaken: string | null;
		};
		expect(body).toMatchObject({ status: "pending", actionTaken: null });
		const after = await adminApp.request(
			`/api/admin/collections/${collection.id}`,
		);
		expect(
			((await after.json()) as { editorialStatus: string }).editorialStatus,
		).toBe("published");
	});
});
