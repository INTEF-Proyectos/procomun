import { describe, expect, test } from "bun:test";
import * as repo from "@procomun/db/repository";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { getDb } from "../db.ts";
import { adminRoutes } from "./admin/index.ts";
import { tagRoutes } from "./tags.ts";

function createPublicApp() {
	const app = new Hono();
	app.route("/api/v1/tags", tagRoutes);
	return app;
}

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

describe("Public tags API (#76)", () => {
	const app = createPublicApp();

	test("GET /api/v1/tags returns paginated list", async () => {
		const db = getDb().db;
		await repo.ensureTag(db, "PublicTagAlpha");

		// The schema seeds 50 catalog keywords (ADR-0042), so page by limit.
		const res = await app.request("/api/v1/tags?limit=1");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toHaveLength(1);
		expect(body.total).toBeGreaterThan(50);
		const detail = await app.request("/api/v1/tags/publictagalpha");
		expect(detail.status).toBe(200);
	});

	test("GET /api/v1/tags?q= suggests matching tags", async () => {
		const db = getDb().db;
		await repo.ensureTag(db, "Robótica escolar");

		const res = await app.request("/api/v1/tags?q=robot");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(
			body.data.some((t: { slug: string }) => t.slug.includes("robotica")),
		).toBe(true);
	});

	test("GET /api/v1/tags/popular returns only used tags", async () => {
		const db = getDb().db;
		const userId = "1";
		const resource = await repo.createResource(db, {
			title: `Popular resource ${crypto.randomUUID()}`,
			description: "d",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			createdBy: userId,
		});
		await repo.setResourceTagsByLabels(db, resource.id, ["PopularPublic"]);

		const res = await app.request("/api/v1/tags/popular?limit=50");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body.data)).toBe(true);
		expect(
			body.data.every((t: { usageCount: number }) => t.usageCount > 0),
		).toBe(true);
		expect(
			body.data.some((t: { slug: string }) => t.slug === "popularpublic"),
		).toBe(true);
	});

	test("GET /api/v1/tags/:slug returns 404 for unknown", async () => {
		const res = await app.request("/api/v1/tags/does-not-exist-xyz");
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error).toBe("Tag not found");
	});

	test("GET /api/v1/tags/:slug returns tag detail", async () => {
		const db = getDb().db;
		const tag = await repo.ensureTag(db, "Detalle Tag");
		const res = await app.request(`/api/v1/tags/${tag.slug}`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.id).toBe(tag.id);
		expect(body.slug).toBe(tag.slug);
		expect(body.label).toBe(tag.label);
	});
});

describe("Admin tags API (#76)", () => {
	const adminApp = createAdminApp({ id: "1", role: "admin" });
	const authorApp = createAdminApp({ id: "1", role: "author" });
	const readerApp = createAdminApp({ id: "1", role: "reader" });

	test("POST merge requires curator+", async () => {
		const db = getDb().db;
		const a = await repo.ensureTag(
			db,
			`MergeA-${crypto.randomUUID().slice(0, 6)}`,
		);
		const b = await repo.ensureTag(
			db,
			`MergeB-${crypto.randomUUID().slice(0, 6)}`,
		);

		const forbidden = await authorApp.request("/api/admin/tags/merge", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sourceId: a.id, targetId: b.id }),
		});
		expect(forbidden.status).toBe(403);

		const ok = await adminApp.request("/api/admin/tags/merge", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sourceId: a.id, targetId: b.id }),
		});
		expect(ok.status).toBe(200);
		const body = await ok.json();
		expect(body.target.id).toBe(b.id);
		expect(typeof body.reassigned).toBe("number");
	});

	test("PUT resource tags by labels as owner", async () => {
		const db = getDb().db;
		const resource = await repo.createResource(db, {
			title: `Tagged resource ${crypto.randomUUID()}`,
			description: "d",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			createdBy: "1",
		});

		const res = await authorApp.request(
			`/api/admin/tags/resources/${resource.id}`,
			{
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ labels: ["Uno", "Dos"] }),
			},
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toHaveLength(2);
		expect(body.data.map((t: { slug: string }) => t.slug).sort()).toEqual([
			"dos",
			"uno",
		]);
	});

	test("POST migrate-keywords is admin-only", async () => {
		const authorRes = await authorApp.request(
			"/api/admin/tags/migrate-keywords",
			{ method: "POST" },
		);
		expect(authorRes.status).toBe(403);

		const adminRes = await adminApp.request(
			"/api/admin/tags/migrate-keywords",
			{ method: "POST" },
		);
		expect(adminRes.status).toBe(200);
		const body = await adminRes.json();
		expect(typeof body.resourcesProcessed).toBe("number");
		expect(typeof body.tagsCreated).toBe("number");
		expect(typeof body.linksCreated).toBe("number");
	});

	test("reader cannot access admin tags", async () => {
		const res = await readerApp.request("/api/admin/tags");
		// author floor on admin routes → 403 for reader
		expect(res.status).toBe(403);
	});

	test("PATCH tag updates label", async () => {
		const db = getDb().db;
		const tag = await repo.ensureTag(
			db,
			`OldLabel-${crypto.randomUUID().slice(0, 6)}`,
		);
		const res = await adminApp.request(`/api/admin/tags/${tag.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ label: "New Label", description: "desc" }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.label).toBe("New Label");
		expect(body.description).toBe("desc");
		expect(body.slug).toBe("new-label");
	});
});
