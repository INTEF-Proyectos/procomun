import { describe, expect, test } from "bun:test";
import * as repo from "@procomun/db/repository";
import { getDb } from "../db.ts";
import { resolveResourceBySlug } from "./resource-resolver.ts";

describe("resolveResourceBySlug", () => {
	test("only resolves published resources", async () => {
		const result = await repo.createResource(getDb().db, {
			title: `Resolver ${crypto.randomUUID()}`,
			description: "desc",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
		});

		expect(await resolveResourceBySlug(result.slug)).toBeNull();

		const curatorId = `curator-${crypto.randomUUID()}`;
		await repo.ensureUser(getDb().db, {
			id: curatorId,
			email: `${curatorId}@test.com`,
			role: "curator",
		});
		await repo.updateEditorialStatus(
			getDb().db,
			result.id,
			"published",
			curatorId,
		);
		const resource = await resolveResourceBySlug(result.slug);
		expect(resource).not.toBeNull();
		expect(resource?.id).toBe(result.id);
		expect(resource?.slug).toBe(result.slug);
	});
});
