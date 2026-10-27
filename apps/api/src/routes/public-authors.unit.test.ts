import { beforeAll, describe, expect, test } from "bun:test";
import * as repo from "@procomun/db/repository";
import { getDb } from "../db.ts";
import { app } from "../index.ts";

// Ids con «:» como los de los usuarios importados del Procomún antiguo.
const AUTHOR_ID = "legacy-test:user:458";
const READER_ID = "lectora-458";

async function seedResource(
	title: string,
	status: "published" | "draft",
	createdAt: Date,
) {
	const { id } = await repo.createResource(getDb().db, {
		title,
		description: "Descripción",
		language: "es",
		license: "cc-by",
		resourceType: "documento",
		createdBy: AUTHOR_ID,
	});
	const { resources } = await import("@procomun/db/schema");
	const { eq } = await import("drizzle-orm");
	await getDb()
		.db.update(resources)
		.set({ createdAt })
		.where(eq(resources.id, id));
	if (status === "published") {
		await repo.updateEditorialStatus(getDb().db, id, "published", "system");
	}
	return id;
}

let deletedId = "";

beforeAll(async () => {
	await repo.ensureUser(getDb().db, {
		id: AUTHOR_ID,
		email: "publicadora-458@test.com",
		name: "Publicadora 458",
		role: "author",
	});
	await repo.ensureUser(getDb().db, {
		id: READER_ID,
		email: "lectora-458@test.com",
		name: "Lectora 458",
		role: "reader",
	});
	await seedResource("Antiguo 458", "published", new Date("2024-01-01"));
	await seedResource("Medio 458", "published", new Date("2025-01-01"));
	await seedResource("Reciente 458", "published", new Date("2026-01-01"));
	await seedResource("Borrador 458", "draft", new Date("2026-06-01"));
	deletedId = await seedResource(
		"Eliminado 458",
		"published",
		new Date("2026-07-01"),
	);
	await repo.deleteResource(getDb().db, deletedId);
});

function authorUrl(query = "") {
	return `/api/v1/authors/${encodeURIComponent(AUTHOR_ID)}${query}`;
}

describe("GET /api/v1/authors/:id (#458)", () => {
	test("devuelve la ficha pública sin datos personales", async () => {
		const res = await app.request(authorUrl());
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.author).toEqual({
			id: AUTHOR_ID,
			name: "Publicadora 458",
			image: null,
		});
		expect(JSON.stringify(body.author)).not.toContain("@");
	});

	test("cuenta y lista solo los publicados, sin borradores ni eliminados, del más reciente al más antiguo", async () => {
		const res = await app.request(authorUrl());
		const body = await res.json();
		expect(body.total).toBe(3);
		expect(body.data.map((r: { title: string }) => r.title)).toEqual([
			"Reciente 458",
			"Medio 458",
			"Antiguo 458",
		]);
	});

	test("el total no depende de la paginación", async () => {
		const res = await app.request(authorUrl("?limit=1&offset=1"));
		const body = await res.json();
		expect(body.total).toBe(3);
		expect(body.data.map((r: { title: string }) => r.title)).toEqual([
			"Medio 458",
		]);
	});

	test("404 para cuentas sin recursos o inexistentes", async () => {
		const reader = await app.request(
			`/api/v1/authors/${encodeURIComponent(READER_ID)}`,
		);
		expect(reader.status).toBe(404);
		const unknown = await app.request("/api/v1/authors/no-existe-458");
		expect(unknown.status).toBe(404);
	});
});
