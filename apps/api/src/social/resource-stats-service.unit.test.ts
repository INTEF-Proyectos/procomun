import { describe, expect, test } from "bun:test";
import * as repo from "@procomun/db/repository";
import { getDb } from "../db.ts";
import { toggleResourceFavorite } from "./favorites-service.ts";
import { upsertResourceRating } from "./ratings-service.ts";
import {
	getResourceSocialStats,
	incrementDownload,
} from "./resource-stats-service.ts";

describe("resource-stats-service", () => {
	test("aggregates download, favorite and rating stats", async () => {
		const userId = `stats-user-${crypto.randomUUID()}`;
		await repo.ensureUser(getDb().db, {
			id: userId,
			email: `${userId}@local.invalid`,
			name: "Stats User",
			role: "author",
		});

		const resource = await repo.createResource(getDb().db, {
			title: `Stats Resource ${crypto.randomUUID()}`,
			description: "desc",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			createdBy: userId,
		});

		await incrementDownload(resource.id, userId);
		await toggleResourceFavorite({ resourceId: resource.id, userId });
		await upsertResourceRating({ resourceId: resource.id, userId, score: 5 });

		const stats = await getResourceSocialStats(resource.id, userId);
		expect(stats.downloadCount).toBe(1);
		expect(stats.favoriteCount).toBe(1);
		expect(stats.ratingAvg).toBe(5);
		expect(stats.ratingCount).toBe(1);
		expect(stats.userFavorited).toBe(true);
		expect(stats.exportCounts).toEqual({
			scorm: 0,
			ims: 0,
			web: 0,
			epub: 0,
		});
	});

	test("counts exports by format separately", async () => {
		const userId = `stats-fmt-${crypto.randomUUID()}`;
		await repo.ensureUser(getDb().db, {
			id: userId,
			email: `${userId}@local.invalid`,
			name: "Format User",
			role: "author",
		});

		const resource = await repo.createResource(getDb().db, {
			title: `Format Resource ${crypto.randomUUID()}`,
			description: "desc",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			createdBy: userId,
		});

		const now = new Date("2026-09-06T12:00:00Z");
		await incrementDownload(resource.id, userId, "scorm", { now });
		await incrementDownload(resource.id, userId, "scorm", { now });
		await incrementDownload(resource.id, userId, "epub");
		await incrementDownload(resource.id, userId, "direct");

		const stats = await getResourceSocialStats(resource.id, userId);
		expect(stats.downloadCount).toBe(3);
		expect(stats.exportCounts.scorm).toBe(1);
		expect(stats.exportCounts.epub).toBe(1);
		expect(stats.exportCounts.ims).toBe(0);
		expect(stats.exportCounts.web).toBe(0);
	});

	test("deduplica replays y vuelve a contar fuera de la ventana", async () => {
		const ownerId = `stats-dedup-${crypto.randomUUID()}`;
		await repo.ensureUser(getDb().db, {
			id: ownerId,
			email: `${ownerId}@local.invalid`,
			name: "Dedup User",
			role: "author",
		});
		const resource = await repo.createResource(getDb().db, {
			title: `Dedup ${crypto.randomUUID()}`,
			description: "desc",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			createdBy: ownerId,
		});
		const now = new Date("2026-09-06T12:00:00Z");
		expect(
			await incrementDownload(resource.id, undefined, "direct", { now }),
		).toBe(1);
		expect(
			await incrementDownload(resource.id, undefined, "direct", { now }),
		).toBe(1);
		expect(
			await incrementDownload(resource.id, undefined, "direct", {
				now: new Date(now.getTime() + 60_001),
			}),
		).toBe(2);
	});
});
