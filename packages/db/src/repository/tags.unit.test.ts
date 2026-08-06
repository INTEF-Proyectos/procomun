import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { DrizzleDB } from "../repository/shared.ts";
import { createResource, ensureUser } from "../repository.ts";
import * as schema from "../schema/index.ts";
import { createTables } from "../setup.ts";
import {
	deleteTag,
	ensureTag,
	getTagById,
	listPopularTags,
	listResourceTags,
	listSimilarTagsFor,
	listTags,
	mergeTags,
	migrateKeywordsToTags,
	setResourceTagsByLabels,
	suggestTags,
	syncTagsFromKeywords,
	TagMergeError,
	TagNotFoundError,
} from "./tags.ts";

describe("tags repository (issue #76)", () => {
	let client: PGlite;
	let db: DrizzleDB;
	let userId: string;
	let resourceId: string;
	let otherResourceId: string;

	beforeEach(async () => {
		client = new PGlite();
		await createTables(client);
		db = drizzle(client, { schema }) as unknown as DrizzleDB;
		userId = crypto.randomUUID();
		await ensureUser(db, {
			id: userId,
			email: `${userId}@tags.test`,
			name: "Tag Tester",
			role: "author",
		});
		const a = await createResource(db, {
			title: `Tags resource A ${crypto.randomUUID()}`,
			description: "desc",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			createdBy: userId,
			keywords: "mates, física",
		});
		const b = await createResource(db, {
			title: `Tags resource B ${crypto.randomUUID()}`,
			description: "desc",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			createdBy: userId,
		});
		resourceId = a.id;
		otherResourceId = b.id;
	});

	afterEach(async () => {
		await client.close();
	});

	test("ensureTag creates once and reuses by slug (accent-insensitive)", async () => {
		const first = await ensureTag(db, "Matemáticas");
		const second = await ensureTag(db, "Matematicas");
		expect(first.id).toBe(second.id);
		expect(first.slug).toBe("matematicas");
		expect(first.label.length).toBeGreaterThan(0);
	});

	test("setResourceTagsByLabels attaches tags and syncs keywords column", async () => {
		const attached = await setResourceTagsByLabels(db, resourceId, [
			"Robótica",
			"IA",
			"robótica",
		]);
		expect(attached.map((t) => t.slug).sort()).toEqual(["ia", "robotica"]);

		const listed = await listResourceTags(db, resourceId);
		expect(listed).toHaveLength(2);

		const resource = await (await import("./resources.ts")).getResourceById(
			db,
			resourceId,
		);
		expect(resource?.keywords).toMatch(/Robótica|IA/);
		expect(resource?.keywords?.split(",").length).toBe(2);

		const refreshed = await listResourceTags(db, resourceId);
		const r = refreshed.find((t) => t.slug === "robotica");
		expect(r?.usageCount).toBeGreaterThanOrEqual(1);
	});

	test("suggestTags matches by query substring", async () => {
		await ensureTag(db, "Ciberseguridad");
		const hits = await suggestTags(db, "ciber", 10);
		expect(hits.some((t) => t.slug === "ciberseguridad")).toBe(true);
		expect(hits[0]?.label.toLowerCase()).toContain("ciber");
	});

	test("listTags supports search and returns only canonical tags by default", async () => {
		await ensureTag(db, "Robótica educativa");
		const page = await listTags(db, { search: "robo", limit: 10, offset: 0 });
		expect(page.total).toBeGreaterThanOrEqual(1);
		expect(page.data.every((t) => t.canonicalTagId === null)).toBe(true);
		expect(page.data.some((t) => t.slug.includes("robotica"))).toBe(true);
	});

	test("mergeTags reassigns resources and marks source as synonym", async () => {
		const source = await ensureTag(db, "Mates");
		const target = await ensureTag(db, "Matemáticas ESO");
		await setResourceTagsByLabels(db, otherResourceId, ["Mates"]);

		const result = await mergeTags(db, source.id, target.id);
		expect(result.target.id).toBe(target.id);
		// Source may already be linked from dual-write on create (keywords) + this test
		expect(result.reassigned).toBeGreaterThanOrEqual(1);

		const tagsOnResource = await listResourceTags(db, otherResourceId);
		expect(tagsOnResource.some((t) => t.id === target.id)).toBe(true);
		expect(tagsOnResource.some((t) => t.id === source.id)).toBe(false);

		const sourceAfter = await getTagById(db, source.id);
		expect(sourceAfter?.canonicalTagId).toBe(target.id);
		expect(sourceAfter?.usageCount).toBe(0);
	});

	test("mergeTags rejects self-merge", async () => {
		const tag = await ensureTag(db, "Historia");
		await expect(mergeTags(db, tag.id, tag.id)).rejects.toBeInstanceOf(
			TagMergeError,
		);
	});

	test("listSimilarTagsFor finds near-duplicate labels", async () => {
		const a = await ensureTag(db, "Geometría");
		// Distinct slug so both exist
		const b = await ensureTag(db, "Geometria basica");
		const similar = await listSimilarTagsFor(db, a.id, {
			maxDistance: 10,
			limit: 10,
		});
		expect(similar.some((t) => t.id === b.id)).toBe(true);
		expect(similar.every((t) => t.id !== a.id)).toBe(true);
	});

	test("migrateKeywordsToTags processes resources with keywords", async () => {
		const created = await createResource(db, {
			title: `Migrate keywords ${crypto.randomUUID()}`,
			description: "desc",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			createdBy: userId,
			keywords: "educación, primaria, STEM",
		});

		const stats = await migrateKeywordsToTags(db);
		expect(stats.resourcesProcessed).toBeGreaterThanOrEqual(1);
		// Dual-write on createResource may already have created tags; migrate is idempotent
		expect(typeof stats.tagsCreated).toBe("number");
		expect(typeof stats.linksCreated).toBe("number");

		const resourceTags = await listResourceTags(db, created.id);
		expect(resourceTags.length).toBe(3);
		const slugs = resourceTags.map((t) => t.slug).sort();
		expect(slugs).toEqual(["educacion", "primaria", "stem"]);
	});

	test("syncTagsFromKeywords replaces previous tags", async () => {
		await setResourceTagsByLabels(db, resourceId, ["Alpha", "Beta"]);
		await syncTagsFromKeywords(db, resourceId, "Gamma");
		const tags = await listResourceTags(db, resourceId);
		expect(tags.map((t) => t.slug)).toEqual(["gamma"]);
		expect(tags).toHaveLength(1);
	});

	test("listPopularTags only returns tags with usage > 0", async () => {
		await setResourceTagsByLabels(db, resourceId, ["PopularTagX"]);
		const popular = await listPopularTags(db, 50);
		expect(popular.length).toBeGreaterThanOrEqual(1);
		expect(popular.every((t) => t.usageCount > 0)).toBe(true);
		expect(popular.some((t) => t.slug === "populartagx")).toBe(true);
	});

	test("deleteTag removes associations", async () => {
		const tag = await ensureTag(
			db,
			`DeleteMe-${crypto.randomUUID().slice(0, 8)}`,
		);
		await setResourceTagsByLabels(db, resourceId, [tag.label, "KeepMe"]);
		await deleteTag(db, tag.id);
		const remaining = await listResourceTags(db, resourceId);
		expect(remaining.some((t) => t.id === tag.id)).toBe(false);
		expect(remaining.some((t) => t.slug === "keepme")).toBe(true);
		expect(await getTagById(db, tag.id)).toBeNull();
	});

	test("mergeTags with missing source throws TagNotFoundError", async () => {
		const target = await ensureTag(db, "Existente");
		await expect(
			mergeTags(db, "00000000-0000-0000-0000-000000000000", target.id),
		).rejects.toBeInstanceOf(TagNotFoundError);
	});
});
