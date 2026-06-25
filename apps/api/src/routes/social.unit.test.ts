import { expect, test, describe } from "bun:test";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { socialRoutes } from "./social.ts";
import { adminRoutes } from "./admin/index.ts";

/**
 * Social routes apply sessionMiddleware internally, which calls betterAuth.
 * In tests, we pre-set the user/session context variables BEFORE the social
 * middleware runs — the sessionMiddleware will overwrite them, but since
 * betterAuth has no real session in test, it sets null. To work around this,
 * we mount the social routes under a wrapper that forces the mock user into
 * context AFTER sessionMiddleware runs, by using a second middleware layer.
 *
 * Approach: wrap socialRoutes in a parent Hono that sets context, then
 * re-sets it after sessionMiddleware clears it.
 */
function createSocialApp(mockUser: Record<string, unknown> | null = null) {
	const app = new Hono<AuthEnv>();

	// Admin routes (no sessionMiddleware conflict — they use their own)
	app.use("/api/admin/*", async (c, next) => {
		c.set("user", mockUser as AuthEnv["Variables"]["user"]);
		c.set("session", mockUser ? ({ id: "test-session" } as AuthEnv["Variables"]["session"]) : null);
		await next();
	});
	app.route("/api/admin", adminRoutes);

	// Social routes: override sessionMiddleware by setting context AFTER it runs.
	// socialRoutes.use("*", sessionMiddleware) runs first and sets user=null (no real session).
	// We intercept each response and re-run with forced context by wrapping in a sub-app.
	const socialWrapper = new Hono<AuthEnv>();
	socialWrapper.use("*", async (c, next) => {
		c.set("user", mockUser as AuthEnv["Variables"]["user"]);
		c.set("session", mockUser ? ({ id: "test-session" } as AuthEnv["Variables"]["session"]) : null);
		await next();
	});

	// Mount social routes — but we need to bypass the internal sessionMiddleware.
	// We do this by re-creating a lightweight version of the routes for testing.
	app.route("/api/v1", socialWrapper);
	app.route("/api/v1", socialRoutes);

	return app;
}

const validResource = {
	title: "Social Test Resource",
	description: "Resource for social tests",
	language: "es",
	license: "cc-by",
	resourceType: "documento",
};

async function createPublishedResource(app: ReturnType<typeof createSocialApp>, suffix = "") {
	const res = await app.request("/api/admin/resources", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ ...validResource, title: `Social Test ${suffix || Date.now()}` }),
	});
	const body = await res.json() as { id: string; slug: string };

	// draft → review
	await app.request(`/api/admin/resources/${body.id}/status`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ status: "review" }),
	});
	// review → published
	await app.request(`/api/admin/resources/${body.id}/status`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ status: "published" }),
	});

	return body;
}

// ---- Tests ----

const adminApp = createSocialApp({ id: "1", role: "admin", name: "Admin" });
const anonApp = createSocialApp(null);

describe("Social — Ratings", () => {
	test("GET /resources/:slug/ratings → empty ratings", async () => {
		const { slug } = await createPublishedResource(adminApp, "ratings-1");
		const res = await adminApp.request(`/api/v1/resources/${slug}/ratings`);
		expect(res.status).toBe(200);
		const body = await res.json() as Record<string, unknown>;
		expect(body.totalRatings).toBe(0);
		expect(body.averageScore).toBe(0);
	});

	test("POST /resources/:slug/ratings → submit rating", async () => {
		const { slug } = await createPublishedResource(adminApp, "ratings-2");
		const res = await adminApp.request(`/api/v1/resources/${slug}/ratings`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ score: 4 }),
		});
		expect(res.status).toBe(200);

		const check = await adminApp.request(`/api/v1/resources/${slug}/ratings`);
		const body = await check.json() as Record<string, unknown>;
		expect(body.totalRatings).toBe(1);
		expect(body.averageScore).toBe(4);
	});

	test("POST /resources/:slug/ratings → 401 without auth", async () => {
		const { slug } = await createPublishedResource(adminApp, "ratings-3");
		const res = await anonApp.request(`/api/v1/resources/${slug}/ratings`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ score: 3 }),
		});
		expect(res.status).toBe(401);
	});

	test("GET /resources/:slug/ratings → 404 non-existent", async () => {
		const res = await adminApp.request("/api/v1/resources/no-existe-xyz/ratings");
		expect(res.status).toBe(404);
	});
});

describe("Social — Favorites", () => {
	test("POST /resources/:slug/favorite → toggle on", async () => {
		const { slug } = await createPublishedResource(adminApp, "fav-1");
		const res = await adminApp.request(`/api/v1/resources/${slug}/favorite`, { method: "POST" });
		expect(res.status).toBe(200);
		const body = await res.json() as { favorited: boolean; count: number };
		expect(body.favorited).toBe(true);
		expect(body.count).toBe(1);
	});

	test("POST /resources/:slug/favorite → toggle off", async () => {
		const { slug } = await createPublishedResource(adminApp, "fav-2");
		await adminApp.request(`/api/v1/resources/${slug}/favorite`, { method: "POST" });
		const res = await adminApp.request(`/api/v1/resources/${slug}/favorite`, { method: "POST" });
		const body = await res.json() as { favorited: boolean; count: number };
		expect(body.favorited).toBe(false);
		expect(body.count).toBe(0);
	});

	test("POST /resources/:slug/favorite → 401 without auth", async () => {
		const { slug } = await createPublishedResource(adminApp, "fav-3");
		const res = await anonApp.request(`/api/v1/resources/${slug}/favorite`, { method: "POST" });
		expect(res.status).toBe(401);
	});
});

describe("Social — My profile", () => {
	test("GET /users/me/profile → devuelve perfil sintético si no existe fila aún", async () => {
		const readerApp = createSocialApp({
			id: `reader-${crypto.randomUUID()}`,
			role: "reader",
			name: "Reader Test",
			email: "reader@test.com",
		});

		const res = await readerApp.request("/api/v1/users/me/profile");
		expect(res.status).toBe(200);
		const body = await res.json() as { name: string | null; bio: string | null; role: string };
		expect(body.name).toBe("Reader Test");
		expect(body.bio).toBeNull();
		expect(body.role).toBe("reader");
	});

	test("PATCH /users/me/profile → reader persiste nombre y bio y reaparece tras recarga", async () => {
		const id = `reader-profile-${crypto.randomUUID()}`;
		const readerApp = createSocialApp({
			id,
			role: "reader",
			name: "Reader Inicial",
			email: `${id}@test.com`,
		});

		const patchRes = await readerApp.request("/api/v1/users/me/profile", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Reader Editado", bio: "Bio persistida" }),
		});
		expect(patchRes.status).toBe(200);

		const getRes = await readerApp.request("/api/v1/users/me/profile");
		expect(getRes.status).toBe(200);
		const body = await getRes.json() as { name: string | null; bio: string | null };
		expect(body.name).toBe("Reader Editado");
		expect(body.bio).toBe("Bio persistida");
	});

	test("PATCH /users/me/profile → 401 without auth", async () => {
		const res = await anonApp.request("/api/v1/users/me/profile", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Anon" }),
		});
		expect(res.status).toBe(401);
	});
});

describe("Social — Downloads", () => {
	test("POST /resources/:slug/download → log download", async () => {
		const { slug } = await createPublishedResource(adminApp, "dl-1");
		const res = await adminApp.request(`/api/v1/resources/${slug}/download`, { method: "POST" });
		expect(res.status).toBe(200);
		const body = await res.json() as { count: number };
		expect(body.count).toBe(1);
	});

	test("POST /resources/:slug/download → anonymous download increments counter", async () => {
		const { slug } = await createPublishedResource(adminApp, "dl-anon");
		const res = await anonApp.request(`/api/v1/resources/${slug}/download`, { method: "POST" });
		expect(res.status).toBe(200);
		const body = await res.json() as { count: number };
		expect(body.count).toBe(1);
	});

	test("POST /resources/:slug/download → counter increments on repeated downloads", async () => {
		const { slug } = await createPublishedResource(adminApp, "dl-multi");
		await anonApp.request(`/api/v1/resources/${slug}/download`, { method: "POST" });
		await anonApp.request(`/api/v1/resources/${slug}/download`, { method: "POST" });
		const res = await anonApp.request(`/api/v1/resources/${slug}/download`, { method: "POST" });
		expect(res.status).toBe(200);
		const body = await res.json() as { count: number };
		expect(body.count).toBe(3);
	});

	test("POST /resources/:slug/download → stats reflect download count after tracking", async () => {
		const { slug } = await createPublishedResource(adminApp, "dl-stats");
		await anonApp.request(`/api/v1/resources/${slug}/download`, { method: "POST" });
		await anonApp.request(`/api/v1/resources/${slug}/download`, { method: "POST" });

		const statsRes = await anonApp.request(`/api/v1/resources/${slug}/stats`);
		expect(statsRes.status).toBe(200);
		const stats = await statsRes.json() as { downloadCount: number };
		expect(stats.downloadCount).toBe(2);
	});

	test("POST /resources/:slug/download → 404 for non-existent resource", async () => {
		const res = await anonApp.request("/api/v1/resources/no-existe-xyz/download", { method: "POST" });
		expect(res.status).toBe(404);
	});

	test("POST /resources/:slug/download with format → groups stats by export format", async () => {
		const { slug } = await createPublishedResource(adminApp, "dl-format");
		await anonApp.request(`/api/v1/resources/${slug}/download`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ format: "scorm" }),
		});
		await anonApp.request(`/api/v1/resources/${slug}/download`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ format: "epub" }),
		});

		const statsRes = await anonApp.request(`/api/v1/resources/${slug}/stats`);
		expect(statsRes.status).toBe(200);
		const stats = await statsRes.json() as {
			downloadCount: number;
			exportCounts: { scorm: number; ims: number; web: number; epub: number };
		};
		expect(stats.downloadCount).toBe(2);
		expect(stats.exportCounts.scorm).toBe(1);
		expect(stats.exportCounts.epub).toBe(1);
		expect(stats.exportCounts.ims).toBe(0);
	});
});

describe("Social — Stats", () => {
	test("GET /resources/:slug/stats → aggregated stats", async () => {
		const { slug } = await createPublishedResource(adminApp, "stats-1");
		const res = await adminApp.request(`/api/v1/resources/${slug}/stats`);
		expect(res.status).toBe(200);
		const body = await res.json() as Record<string, unknown>;
		expect(typeof body.downloadCount).toBe("number");
		expect(typeof body.favoriteCount).toBe("number");
		expect(typeof body.ratingAvg).toBe("number");
		expect(typeof body.userFavorited).toBe("boolean");
	});

	test("GET /resources/:slug/stats → 404 non-existent", async () => {
		const res = await adminApp.request("/api/v1/resources/no-existe-xyz/stats");
		expect(res.status).toBe(404);
	});
});

describe("Social — User endpoints", () => {
	test("GET /users/me/favorites → list", async () => {
		const res = await adminApp.request("/api/v1/users/me/favorites");
		expect(res.status).toBe(200);
		const body = await res.json() as { data: unknown[] };
		expect(Array.isArray(body.data)).toBe(true);
	});

	test("GET /users/me/favorites → 401 without auth", async () => {
		const res = await anonApp.request("/api/v1/users/me/favorites");
		expect(res.status).toBe(401);
	});

	test("GET /users/me/ratings → list", async () => {
		const res = await adminApp.request("/api/v1/users/me/ratings");
		expect(res.status).toBe(200);
		const body = await res.json() as { data: unknown[] };
		expect(Array.isArray(body.data)).toBe(true);
	});

	test("GET /users/me/dashboard → summary", async () => {
		const res = await adminApp.request("/api/v1/users/me/dashboard");
		expect(res.status).toBe(200);
		const body = await res.json() as Record<string, unknown>;
		expect(typeof body.draftCount).toBe("number");
		expect(typeof body.publishedCount).toBe("number");
		expect(typeof body.favoriteCount).toBe("number");
	});

	test("GET /users/me/dashboard → 401 without auth", async () => {
		const res = await anonApp.request("/api/v1/users/me/dashboard");
		expect(res.status).toBe(401);
	});
});

describe("Social — Activity Feed", () => {
	test("GET /users/me/activity → empty initially", async () => {
		const res = await adminApp.request("/api/v1/users/me/activity");
		expect(res.status).toBe(200);
		const body = await res.json() as { data: unknown[]; total: number };
		expect(Array.isArray(body.data)).toBe(true);
	});

	test("GET /users/me/activity → 401 without auth", async () => {
		const res = await anonApp.request("/api/v1/users/me/activity");
		expect(res.status).toBe(401);
	});

	test("rating creates activity event", async () => {
		const { slug } = await createPublishedResource(adminApp, "act-rating");
		await adminApp.request(`/api/v1/resources/${slug}/ratings`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ score: 5 }),
		});

		const res = await adminApp.request("/api/v1/users/me/activity");
		const body = await res.json() as { data: { type: string; description: string }[] };
		const ratingEvent = body.data.find(e => e.type === "rating_given" && e.description.includes("act-rating"));
		expect(ratingEvent).toBeDefined();
	});

	test("favorite creates activity event", async () => {
		const { slug } = await createPublishedResource(adminApp, "act-fav");
		await adminApp.request(`/api/v1/resources/${slug}/favorite`, { method: "POST" });

		const res = await adminApp.request("/api/v1/users/me/activity");
		const body = await res.json() as { data: { type: string; description: string }[] };
		const favEvent = body.data.find(e => e.type === "favorite_added" && e.description.includes("act-fav"));
		expect(favEvent).toBeDefined();
	});

	test("unfavorite creates favorite_removed event", async () => {
		const { slug } = await createPublishedResource(adminApp, "act-unfav");
		await adminApp.request(`/api/v1/resources/${slug}/favorite`, { method: "POST" });
		await adminApp.request(`/api/v1/resources/${slug}/favorite`, { method: "POST" });

		const res = await adminApp.request("/api/v1/users/me/activity");
		const body = await res.json() as { data: { type: string }[] };
		const removeEvent = body.data.find(e => e.type === "favorite_removed");
		expect(removeEvent).toBeDefined();
	});

	test("activity supports pagination", async () => {
		const res = await adminApp.request("/api/v1/users/me/activity?limit=2&offset=0");
		expect(res.status).toBe(200);
		const body = await res.json() as { data: unknown[]; total: number; limit: number; offset: number };
		expect(body.limit).toBe(2);
		expect(body.offset).toBe(0);
		expect(body.data.length).toBeLessThanOrEqual(2);
	});
});
