import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";

// `mock.module` vale para todo el proceso y `mock.restore()` no lo deshace:
// se guarda el servicio real para reponerlo al acabar. Sin esto, cualquier
// test que use los feeds de verdad y corra después recibe el doble (#568).
const realFeedService = { ...(await import("../feeds/service.ts")) };
afterAll(() => {
	mock.module("../feeds/service.ts", () => realFeedService);
});

// Mock the feed service to avoid DB dependency
const mockBuildGeneralFeed = mock((_opts?: Record<string, unknown>) => {
	const { Feed } = require("feed");
	const feed = new Feed({
		title: "Mock Feed",
		description: "Mock",
		id: "http://localhost/feeds/atom/resources",
		link: "http://localhost",
		copyright: "test",
	});
	feed.addItem({
		title: "Test Resource",
		id: "http://localhost/recursos/test",
		link: "http://localhost/recursos/test",
		date: new Date("2026-01-01"),
		description: "A test resource",
	});
	return feed;
});

const mockBuildCollectionFeed = mock((_opts?: Record<string, unknown>) =>
	mockBuildGeneralFeed(),
);
const mockBuildUserFeed = mock((_opts?: Record<string, unknown>) =>
	mockBuildGeneralFeed(),
);

mock.module("../feeds/service.ts", () => ({
	buildGeneralFeed: mockBuildGeneralFeed,
	buildCollectionFeed: mockBuildCollectionFeed,
	buildUserFeed: mockBuildUserFeed,
}));

// Import routes after mocking
const { feedRoutes } = await import("./feeds.ts");

describe("feed routes", () => {
	const app = new Hono();
	app.route("/feeds", feedRoutes);

	beforeEach(() => {
		mockBuildGeneralFeed.mockClear();
		mockBuildCollectionFeed.mockClear();
		mockBuildUserFeed.mockClear();
	});

	test("GET /feeds/atom/resources returns Atom XML", async () => {
		const res = await app.request("/feeds/atom/resources");

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe(
			"application/atom+xml; charset=utf-8",
		);
		expect(res.headers.get("cache-control")).toBe("public, max-age=3600");

		const body = await res.text();
		expect(body).toContain("<?xml");
		expect(body).toContain("<feed");
	});

	test("GET /feeds/rss/resources returns RSS XML", async () => {
		const res = await app.request("/feeds/rss/resources");

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe(
			"application/rss+xml; charset=utf-8",
		);

		const body = await res.text();
		expect(body).toContain("<rss");
	});

	test("GET /feeds/atom/users/:userId calls buildUserFeed", async () => {
		const res = await app.request("/feeds/atom/users/user-123");

		expect(res.status).toBe(200);
		expect(mockBuildUserFeed).toHaveBeenCalledTimes(1);
		const call = mockBuildUserFeed.mock.calls[0];
		expect(call).toBeDefined();
		const args = call?.[0];
		expect(args).toBeDefined();
		expect(args?.createdBy).toBe("user-123");
	});

	test("GET /feeds/atom/collections/:slug returns 404 when not found", async () => {
		mockBuildCollectionFeed.mockImplementationOnce(() => null);
		const res = await app.request("/feeds/atom/collections/nonexistent");

		expect(res.status).toBe(404);
	});

	test("GET /feeds/atom/resources passes query params", async () => {
		await app.request(
			"/feeds/atom/resources?limit=10&offset=5&q=math&resourceType=documento",
		);

		expect(mockBuildGeneralFeed).toHaveBeenCalledTimes(1);
		const call = mockBuildGeneralFeed.mock.calls[0];
		expect(call).toBeDefined();
		const args = call?.[0];
		expect(args).toBeDefined();
		expect(args?.limit).toBe(10);
		expect(args?.offset).toBe(5);
		expect(args?.search).toBe("math");
		expect(args?.resourceType).toBe("documento");
	});
});
