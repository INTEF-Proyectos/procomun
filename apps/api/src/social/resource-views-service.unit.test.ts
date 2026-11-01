import { describe, expect, test } from "bun:test";
import * as repo from "@procomun/db/repository";
import { resourceViewCounts, resourceViewSessions } from "@procomun/db/schema";
import { eq } from "drizzle-orm";
import { getDb } from "../db.ts";
import {
	getResourceViewCount,
	hashViewSession,
	isValidViewSessionId,
	recordResourceView,
	VIEW_SESSION_WINDOW_MS,
} from "./resource-views-service.ts";

async function createResource() {
	return repo.createResource(getDb().db, {
		title: `Views Resource ${crypto.randomUUID()}`,
		description: "desc",
		language: "es",
		license: "cc-by",
		resourceType: "documento",
	});
}

describe("resource-views-service", () => {
	test("solo acepta UUID como identificador de sesión", () => {
		expect(isValidViewSessionId(crypto.randomUUID())).toBe(true);
		expect(isValidViewSessionId("127.0.0.1")).toBe(false);
		expect(isValidViewSessionId(42)).toBe(false);
		expect(isValidViewSessionId(undefined)).toBe(false);
	});

	test("guarda solo el hash de la sesión, nunca el identificador", async () => {
		const resource = await createResource();
		const sessionId = crypto.randomUUID();
		await recordResourceView(resource.id, sessionId);

		const rows = await getDb()
			.db.select()
			.from(resourceViewSessions)
			.where(eq(resourceViewSessions.resourceId, resource.id));
		expect(rows).toHaveLength(1);
		expect(rows[0]?.sessionHash).toBe(hashViewSession(sessionId));
		expect(rows[0]?.sessionHash).not.toContain(sessionId);
	});

	test("pasada la ventana, la misma sesión vuelve a contar", async () => {
		const resource = await createResource();
		const sessionId = crypto.randomUUID();
		const start = new Date("2026-10-26T08:00:00.000Z");

		expect(
			await recordResourceView(resource.id, sessionId, { now: start }),
		).toBe(1);
		expect(
			await recordResourceView(resource.id, sessionId, {
				now: new Date(start.getTime() + 60_000),
			}),
		).toBe(1);
		expect(
			await recordResourceView(resource.id, sessionId, {
				now: new Date(start.getTime() + VIEW_SESSION_WINDOW_MS + 1),
			}),
		).toBe(2);
	});

	test("el total suma las visitas históricas importadas", async () => {
		const resource = await createResource();
		await getDb()
			.db.insert(resourceViewCounts)
			.values({ resourceId: resource.id, legacyViewCount: 120 });

		expect(await getResourceViewCount(resource.id)).toBe(120);
		expect(await recordResourceView(resource.id, crypto.randomUUID())).toBe(
			121,
		);
	});

	test("un recurso sin visitas devuelve 0", async () => {
		const resource = await createResource();
		expect(await getResourceViewCount(resource.id)).toBe(0);
	});
});
