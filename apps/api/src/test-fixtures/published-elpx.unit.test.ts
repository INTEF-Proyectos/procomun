import { describe, expect, test } from "bun:test";
import * as repo from "@procomun/db/repository";
import { getDb } from "../db.ts";
import { seedPublishedElpxHash } from "./published-elpx.ts";

describe("seedPublishedElpxHash", () => {
	test("asocia el hash a un recurso publicado y es idempotente", async () => {
		const hash = crypto.randomUUID().replaceAll("-", "").padEnd(40, "c");
		const first = await seedPublishedElpxHash(hash);
		expect(await repo.getElpxResourceStatusByHash(getDb().db, hash)).toEqual({
			resourceId: first.resourceId,
			editorialStatus: "published",
		});

		await repo.updateEditorialStatus(
			getDb().db,
			first.resourceId,
			"draft",
			"system",
		);
		const second = await seedPublishedElpxHash(hash);
		expect(second.resourceId).toBe(first.resourceId);
		expect(
			(await repo.getElpxResourceStatusByHash(getDb().db, hash))
				?.editorialStatus,
		).toBe("published");
	});
});
