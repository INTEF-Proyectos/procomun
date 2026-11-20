import { describe, expect, test } from "bun:test";
import * as repo from "@procomun/db/repository";
import { getDb } from "../db.ts";
import { getUserDashboardSummary } from "./dashboard-service.ts";
import { toggleResourceFavorite } from "./favorites-service.ts";
import { upsertResourceRating } from "./ratings-service.ts";

describe("dashboard-service", () => {
	test("returns user counts", async () => {
		const userId = `dashboard-user-${crypto.randomUUID()}`;
		await repo.ensureUser(getDb().db, {
			id: userId,
			email: `${userId}@local.invalid`,
			name: "Dashboard User",
			role: "author",
		});

		await repo.createResource(getDb().db, {
			title: `Draft ${crypto.randomUUID()}`,
			description: "desc",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			createdBy: userId,
		});
		const published = await repo.createResource(getDb().db, {
			title: `Published ${crypto.randomUUID()}`,
			description: "desc",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			createdBy: userId,
		});
		await repo.updateEditorialStatus(
			getDb().db,
			published.id,
			"published",
			userId,
		);
		await toggleResourceFavorite({ resourceId: published.id, userId });
		await upsertResourceRating({ resourceId: published.id, userId, score: 4 });

		const summary = await getUserDashboardSummary(userId);
		expect(summary.draftCount).toBe(1);
		expect(summary.publishedCount).toBe(1);
		expect(summary.favoriteCount).toBe(1);
		expect(summary.ratingCount).toBe(1);
		// #530: «Mis recursos» tiene su propio listado; el resumen solo cuenta.
		expect(summary).not.toHaveProperty("recentResources");
	});
});

describe("dashboard-service — contadores de «Mis recursos» (#530)", () => {
	test("cuenta los cuatro estados y el total cuadra con su suma", async () => {
		const userId = `dashboard-counts-${crypto.randomUUID()}`;
		await repo.ensureUser(getDb().db, {
			id: userId,
			email: `${userId}@local.invalid`,
			name: "Contadores",
			role: "author",
		});
		const statuses = ["draft", "review", "published", "archived", "review"];
		for (const status of statuses) {
			const created = await repo.createResource(getDb().db, {
				title: `Contador ${status} ${crypto.randomUUID()}`,
				description: "desc",
				language: "es",
				license: "cc-by",
				resourceType: "documento",
				createdBy: userId,
			});
			if (status !== "draft") {
				await repo.updateEditorialStatus(
					getDb().db,
					created.id,
					status,
					userId,
				);
			}
		}

		const summary = await getUserDashboardSummary(userId);
		expect(summary.draftCount).toBe(1);
		expect(summary.reviewCount).toBe(2);
		expect(summary.publishedCount).toBe(1);
		expect(summary.archivedCount).toBe(1);
		expect(summary.resourceCount).toBe(5);
	});
});
