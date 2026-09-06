import { describe, expect, test } from "bun:test";
import { getDb } from "../../../../apps/api/src/db.ts";
import { createResource } from "./resources.ts";
import {
	cancelUploadSession,
	createUploadSessionWithinQuota,
} from "./uploads.ts";

async function uploadInput(ownerId: string, size: number) {
	const resource = await createResource(getDb().db, {
		title: `Quota ${crypto.randomUUID()}`,
		description: "desc",
		language: "es",
		license: "cc-by",
		resourceType: "documento",
		createdBy: ownerId,
	});
	const id = crypto.randomUUID();
	return {
		id,
		resourceId: resource.id,
		ownerId,
		originalFilename: `${id}.pdf`,
		mimeType: "application/pdf",
		storageKey: `resource/${resource.id}/${id}.pdf`,
		declaredSize: size,
	};
}

describe("upload quota", () => {
	test("reserva de forma atómica y libera sesiones canceladas", async () => {
		const ownerId = "1";
		const first = await uploadInput(ownerId, 60);
		const second = await uploadInput(ownerId, 60);
		expect(await createUploadSessionWithinQuota(getDb().db, first, 100)).toBe(
			true,
		);
		expect(await createUploadSessionWithinQuota(getDb().db, second, 100)).toBe(
			false,
		);
		await cancelUploadSession(getDb().db, first.id);
		expect(await createUploadSessionWithinQuota(getDb().db, second, 100)).toBe(
			true,
		);
	});

	test("dos reservas concurrentes no pueden superar la cuota", async () => {
		const ownerId = "system";
		const [first, second] = await Promise.all([
			uploadInput(ownerId, 60),
			uploadInput(ownerId, 60),
		]);
		const results = await Promise.all([
			createUploadSessionWithinQuota(getDb().db, first, 100),
			createUploadSessionWithinQuota(getDb().db, second, 100),
		]);
		expect(results.filter(Boolean)).toHaveLength(1);
	});
});
