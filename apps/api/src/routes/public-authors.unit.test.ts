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

// Revisión de #487: la ficha solo existe si la cuenta tiene algún recurso
// publicado y no eliminado. Si no, la misma respuesta que un id desconocido,
// para que no se pueda saber si la cuenta existe ni cómo se llama.
describe("GET /api/v1/authors/:id sin recursos publicados (#487)", () => {
	const ACCOUNTS = {
		drafts: "solo-borradores-487",
		deleted: "solo-eliminados-487",
		reviewArchived: "revision-archivo-487",
		onePublished: "una-publicada-487",
	} as const;

	async function seedFor(
		createdBy: string,
		title: string,
		status: "draft" | "review" | "published" | "archived",
	) {
		const { id } = await repo.createResource(getDb().db, {
			title,
			description: "Descripción",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			createdBy,
		});
		if (status !== "draft") {
			await repo.updateEditorialStatus(getDb().db, id, status, "system");
		}
		return id;
	}

	async function getAuthor(id: string) {
		const res = await app.request(`/api/v1/authors/${encodeURIComponent(id)}`);
		return { status: res.status, body: await res.json() };
	}

	beforeAll(async () => {
		for (const id of Object.values(ACCOUNTS)) {
			await repo.ensureUser(getDb().db, {
				id,
				email: `${id}@test.com`,
				name: `Nombre ${id}`,
				role: "author",
			});
		}
		await seedFor(ACCOUNTS.drafts, "Borrador A 487", "draft");
		await seedFor(ACCOUNTS.drafts, "Borrador B 487", "draft");
		await repo.deleteResource(
			getDb().db,
			await seedFor(ACCOUNTS.deleted, "Eliminado 487", "published"),
		);
		await seedFor(ACCOUNTS.reviewArchived, "En revisión 487", "review");
		await seedFor(ACCOUNTS.reviewArchived, "Archivado 487", "archived");
		await seedFor(ACCOUNTS.onePublished, "Publicado 487", "published");
		await seedFor(ACCOUNTS.onePublished, "Borrador C 487", "draft");
		await seedFor(ACCOUNTS.onePublished, "Borrador D 487", "draft");
	});

	for (const [label, id] of [
		["solo borradores", ACCOUNTS.drafts],
		["solo recursos eliminados", ACCOUNTS.deleted],
		["solo recursos en revisión o archivados", ACCOUNTS.reviewArchived],
	] as const) {
		test(`404 igual que un id desconocido para cuentas con ${label}`, async () => {
			const unknown = await getAuthor("no-existe-487");
			const account = await getAuthor(id);
			expect(account.status).toBe(404);
			expect(account).toEqual(unknown);
			expect(JSON.stringify(account.body)).not.toContain(`Nombre ${id}`);
		});
	}

	test("con un publicado y borradores, 200 y cuenta solo el publicado", async () => {
		const { status, body } = await getAuthor(ACCOUNTS.onePublished);
		expect(status).toBe(200);
		expect(body.author).toEqual({
			id: ACCOUNTS.onePublished,
			name: `Nombre ${ACCOUNTS.onePublished}`,
			image: null,
		});
		expect(body.total).toBe(1);
		expect(body.data.map((r: { title: string }) => r.title)).toEqual([
			"Publicado 487",
		]);
	});
});
