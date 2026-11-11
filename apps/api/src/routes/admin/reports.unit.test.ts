import { describe, expect, test } from "bun:test";
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
