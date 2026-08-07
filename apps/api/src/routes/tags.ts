import * as repo from "@procomun/db/repository";
import { Hono } from "hono";
import { getDb } from "../db.ts";
import { parsePagination } from "../http/pagination.ts";
import { listPublishedResources } from "../public/service.ts";

/**
 * Public tag discovery API (issue #76).
 * Autocomplete, popular tags, tag detail and resources by tag.
 */
const tagRoutes = new Hono();

tagRoutes.get("/", async (c) => {
	const { limit, offset, search } = parsePagination(c);
	const q = c.req.query("q") ?? search;
	if (q) {
		const data = await repo.suggestTags(getDb().db, q, limit);
		return c.json({ data, total: data.length, limit, offset: 0 });
	}
	return c.json(await repo.listTags(getDb().db, { limit, offset }));
});

tagRoutes.get("/popular", async (c) => {
	const limit = Math.min(
		50,
		Math.max(1, Number(c.req.query("limit") ?? "20") || 20),
	);
	const data = await repo.listPopularTags(getDb().db, limit);
	return c.json({ data });
});

tagRoutes.get("/:slug", async (c) => {
	const slug = c.req.param("slug");
	if (!slug) return c.json({ error: "Missing slug" }, 400);
	const tag = await repo.getTagBySlug(getDb().db, slug);
	if (!tag) return c.json({ error: "Tag not found" }, 404);

	const canonicalId = tag.canonicalTagId ?? tag.id;
	const canonical =
		canonicalId === tag.id
			? tag
			: ((await repo.getTagById(getDb().db, canonicalId)) ?? tag);

	return c.json(canonical);
});

tagRoutes.get("/:slug/resources", async (c) => {
	const slug = c.req.param("slug");
	if (!slug) return c.json({ error: "Missing slug" }, 400);

	try {
		const { tag, resourceIds } = await repo.listResourceIdsByTagSlug(
			getDb().db,
			slug,
		);
		const { limit, offset } = parsePagination(c);

		if (resourceIds.length === 0) {
			return c.json({
				tag,
				data: [],
				total: 0,
				limit,
				offset,
			});
		}

		// Load published resources and filter to those with the tag
		const published = await listPublishedResources({
			limit: 500,
			offset: 0,
		});
		const idSet = new Set(resourceIds);
		const matched = published.data.filter((r) => idSet.has(r.id));
		const page = matched.slice(offset, offset + limit);

		return c.json({
			tag,
			data: page,
			total: matched.length,
			limit,
			offset,
		});
	} catch (err) {
		if (err instanceof repo.TagNotFoundError) {
			return c.json({ error: "Tag not found" }, 404);
		}
		throw err;
	}
});

export { tagRoutes };
