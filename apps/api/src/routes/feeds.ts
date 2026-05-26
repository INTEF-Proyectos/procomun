import { Hono } from "hono";
import { buildGeneralFeed, buildCollectionFeed, buildUserFeed } from "../feeds/service.ts";

const feedRoutes = new Hono();

function getBaseUrl(c: { req: { url: string } }): string {
	const url = new URL(c.req.url);
	return process.env.PUBLIC_URL ?? `${url.protocol}//${url.host}`;
}

function parseFeedPagination(c: { req: { query: (key: string) => string | undefined } }) {
	const limit = Math.min(Math.max(Number(c.req.query("limit") ?? "20") || 20, 1), 50);
	const offset = Math.max(Number(c.req.query("offset") ?? "0") || 0, 0);
	return { limit, offset };
}

// ---------------------------------------------------------------------------
// Atom feeds
// ---------------------------------------------------------------------------

feedRoutes.get("/atom/resources", async (c) => {
	const { limit, offset } = parseFeedPagination(c);
	const baseUrl = getBaseUrl(c);
	const resourceType = c.req.query("resourceType") ?? undefined;
	const language = c.req.query("language") ?? undefined;
	const license = c.req.query("license") ?? undefined;
	const search = c.req.query("q") ?? undefined;

	const feed = await buildGeneralFeed({
		baseUrl,
		limit,
		offset,
		resourceType,
		language,
		license,
		search,
	});

	return c.body(feed.atom1(), 200, {
		"Content-Type": "application/atom+xml; charset=utf-8",
		"Cache-Control": "public, max-age=3600",
	});
});

feedRoutes.get("/atom/collections/:slug", async (c) => {
	const { slug } = c.req.param();
	const { limit, offset } = parseFeedPagination(c);
	const baseUrl = getBaseUrl(c);

	const feed = await buildCollectionFeed({ baseUrl, limit, offset, collectionSlug: slug });
	if (!feed) {
		return c.json({ error: "Colección no encontrada" }, 404);
	}

	return c.body(feed.atom1(), 200, {
		"Content-Type": "application/atom+xml; charset=utf-8",
		"Cache-Control": "public, max-age=3600",
	});
});

feedRoutes.get("/atom/users/:userId", async (c) => {
	const { userId } = c.req.param();
	const { limit, offset } = parseFeedPagination(c);
	const baseUrl = getBaseUrl(c);

	const feed = await buildUserFeed({ baseUrl, limit, offset, createdBy: userId });

	return c.body(feed.atom1(), 200, {
		"Content-Type": "application/atom+xml; charset=utf-8",
		"Cache-Control": "public, max-age=3600",
	});
});

// ---------------------------------------------------------------------------
// RSS feeds (same data, different format)
// ---------------------------------------------------------------------------

feedRoutes.get("/rss/resources", async (c) => {
	const { limit, offset } = parseFeedPagination(c);
	const baseUrl = getBaseUrl(c);
	const resourceType = c.req.query("resourceType") ?? undefined;
	const language = c.req.query("language") ?? undefined;
	const license = c.req.query("license") ?? undefined;
	const search = c.req.query("q") ?? undefined;

	const feed = await buildGeneralFeed({
		baseUrl,
		limit,
		offset,
		resourceType,
		language,
		license,
		search,
	});

	return c.body(feed.rss2(), 200, {
		"Content-Type": "application/rss+xml; charset=utf-8",
		"Cache-Control": "public, max-age=3600",
	});
});

feedRoutes.get("/rss/collections/:slug", async (c) => {
	const { slug } = c.req.param();
	const { limit, offset } = parseFeedPagination(c);
	const baseUrl = getBaseUrl(c);

	const feed = await buildCollectionFeed({ baseUrl, limit, offset, collectionSlug: slug });
	if (!feed) {
		return c.json({ error: "Colección no encontrada" }, 404);
	}

	return c.body(feed.rss2(), 200, {
		"Content-Type": "application/rss+xml; charset=utf-8",
		"Cache-Control": "public, max-age=3600",
	});
});

feedRoutes.get("/rss/users/:userId", async (c) => {
	const { userId } = c.req.param();
	const { limit, offset } = parseFeedPagination(c);
	const baseUrl = getBaseUrl(c);

	const feed = await buildUserFeed({ baseUrl, limit, offset, createdBy: userId });

	return c.body(feed.rss2(), 200, {
		"Content-Type": "application/rss+xml; charset=utf-8",
		"Cache-Control": "public, max-age=3600",
	});
});

export { feedRoutes };
