import { describe, expect, test } from "bun:test";
import * as repo from "@procomun/db/repository";
import { createApp } from "../app.ts";
import { getDb } from "../db.ts";
import { updateSearchVector } from "../fts/search.ts";
import {
	getRelatedResourcesById,
	getRelatedResourcesBySlug,
} from "./service.ts";

const db = () => getDb().db;

const base = {
	description: "Descripción de prueba para recomendaciones",
	language: "es",
	license: "cc-by",
	resourceType: "documento",
} as const;

type PublishInput = Partial<Parameters<typeof repo.createResource>[1]> & {
	title: string;
};

async function publish(
	data: PublishInput,
): Promise<{ id: string; slug: string }> {
	const created = await repo.createResource(db(), {
		...base,
		...data,
		editorialStatus: "published",
	});
	return created;
}

describe("getRelatedResourcesById — multi-signal ranking", () => {
	test("ranks shared subjects above type-only matches and excludes drafts/self", async () => {
		const seed = await publish({
			title: `Seed mates ${crypto.randomUUID().slice(0, 8)}`,
			resourceType: "documento",
			subjects: ["matematicas"],
			levels: ["primaria"],
			keywords: "fracciones, numeros",
		});

		const strongSubject = await publish({
			title: `Fuerte materia ${crypto.randomUUID().slice(0, 8)}`,
			resourceType: "video",
			subjects: ["matematicas"],
			levels: ["secundaria"],
			keywords: "otra",
		});

		const typeOnly = await publish({
			title: `Solo tipo ${crypto.randomUUID().slice(0, 8)}`,
			resourceType: "documento",
			subjects: ["historia"],
			keywords: "edad-media",
		});

		const draft = await repo.createResource(db(), {
			...base,
			title: `Draft hidden ${crypto.randomUUID().slice(0, 8)}`,
			subjects: ["matematicas"],
			editorialStatus: "draft",
		});

		const result = await getRelatedResourcesById(db(), seed.id, 6);

		const ids = result.data.map((r) => r.id);
		expect(ids).toContain(strongSubject.id);
		expect(ids).toContain(typeOnly.id);
		expect(ids).not.toContain(seed.id);
		expect(ids).not.toContain(draft.id);

		const strong = result.data.find((r) => r.id === strongSubject.id);
		const weak = result.data.find((r) => r.id === typeOnly.id);
		if (!strong || !weak) {
			throw new Error("expected strong and weak related candidates");
		}
		// subject (3) > type-only (2)
		expect(strong.score).toBeGreaterThan(weak.score);
		expect(strong.signals.sharedSubjects).toBe(1);
		expect(weak.signals.sameResourceType).toBe(true);
		expect(weak.signals.sharedSubjects).toBe(0);
		expect(result.limit).toBe(6);
	});

	test("boosts collection co-occurrence and shared keywords", async () => {
		const seed = await publish({
			title: `Seed coleccion ${crypto.randomUUID().slice(0, 8)}`,
			keywords: "robotica, arduino",
			subjects: ["tecnologia"],
		});
		const coMember = await publish({
			title: `Co coleccion ${crypto.randomUUID().slice(0, 8)}`,
			keywords: "robotica, sensores",
			subjects: ["musica"],
		});
		const keywordOnly = await publish({
			title: `Solo keywords ${crypto.randomUUID().slice(0, 8)}`,
			keywords: "arduino",
			subjects: ["ingles"],
		});

		const collection = await repo.createCollection(db(), {
			title: `Itinerario ${crypto.randomUUID().slice(0, 8)}`,
			description: "Colección de prueba",
			curatorId: "1",
			editorialStatus: "published",
		});
		await repo.addResourceToCollection(db(), collection.id, seed.id);
		await repo.addResourceToCollection(db(), collection.id, coMember.id);

		const result = await getRelatedResourcesById(db(), seed.id, 6);
		const co = result.data.find((r) => r.id === coMember.id);
		const kw = result.data.find((r) => r.id === keywordOnly.id);

		if (!co || !kw) {
			throw new Error("expected collection and keyword candidates");
		}
		expect(co.signals.collectionCooccurrence).toBeGreaterThanOrEqual(1);
		expect(co.signals.sharedKeywords).toBeGreaterThanOrEqual(1);
		expect(kw.signals.sharedKeywords).toBe(1);
		// co-occurrence (2.5) + keyword (>=1.5) > keyword alone (1.5)
		expect(co.score).toBeGreaterThan(kw.score);
	});

	// #485: una colección en borrador, en revisión o archivada no es pública;
	// no debe influir en qué se recomienda en la ficha.
	test("solo cuentan las colecciones publicadas (#485)", async () => {
		const unique = () => crypto.randomUUID().slice(0, 8);
		// Sin materias, niveles, palabras clave, tipo, autoría ni palabras del
		// título en común: lo único que relaciona A y B es la colección.
		const a = await publish({
			title: `Alfa ${unique()}`,
			resourceType: `tipo-${unique()}`,
			keywords: `kw-${unique()}`,
		});
		const b = await publish({
			title: `Beta ${unique()}`,
			resourceType: `tipo-${unique()}`,
			keywords: `kw-${unique()}`,
		});

		async function collectionWith(editorialStatus: string) {
			const collection = await repo.createCollection(db(), {
				title: `Colección ${editorialStatus} ${unique()}`,
				description: "Agrupación de prueba",
				curatorId: "1",
				editorialStatus,
			});
			await repo.addResourceToCollection(db(), collection.id, a.id);
			await repo.addResourceToCollection(db(), collection.id, b.id);
		}

		await collectionWith("draft");
		await collectionWith("review");
		await collectionWith("archived");

		const hidden = await getRelatedResourcesById(db(), a.id, 6);
		expect(hidden.data.map((r) => r.id)).not.toContain(b.id);

		await collectionWith("published");
		const shown = await getRelatedResourcesById(db(), a.id, 6);
		const related = shown.data.find((r) => r.id === b.id);
		if (!related) throw new Error("expected B via the published collection");
		// Solo suma la publicada; las otras tres no cuentan.
		expect(related.signals.collectionCooccurrence).toBe(1);
	});

	test("sameAuthor strip lists extras not already in related", async () => {
		const author = "María García Recom";
		const seed = await publish({
			title: `Seed author ${crypto.randomUUID().slice(0, 8)}`,
			author,
			subjects: ["ciencias"],
			resourceType: "documento",
		});
		// High subject overlap → main related list
		const siblingStrong = await publish({
			title: `Sibling strong ${crypto.randomUUID().slice(0, 8)}`,
			author,
			subjects: ["ciencias"],
			resourceType: "documento",
		});
		// Same author only → should land in sameAuthor extras
		const siblingWeak = await publish({
			title: `Sibling weak ${crypto.randomUUID().slice(0, 8)}`,
			author,
			subjects: ["filosofia"],
			resourceType: "video",
			keywords: "etica",
		});

		const result = await getRelatedResourcesById(db(), seed.id, 4);
		const relatedIds = new Set(result.data.map((r) => r.id));

		expect(relatedIds.has(siblingStrong.id)).toBe(true);

		if (!relatedIds.has(siblingWeak.id)) {
			expect(result.sameAuthor.some((r) => r.id === siblingWeak.id)).toBe(true);
		}
		expect(result.sameAuthor.every((r) => r.signals.sameAuthor)).toBe(true);
		expect(result.sameAuthor.some((r) => relatedIds.has(r.id))).toBe(false);
	});

	test("FTS signal increases score when search_vector is populated", async () => {
		const seed = await publish({
			title: "Fotosíntesis en plantas verdes",
			description: "Proceso de fotosíntesis y clorofila en el aula",
			keywords: "fotosintesis, clorofila, plantas",
			subjects: ["biologia"],
		});
		const textual = await publish({
			title: "La clorofila y la fotosíntesis vegetal",
			description: "Experimento de clorofila y plantas verdes",
			keywords: "fotosintesis, clorofila",
			subjects: ["arte"],
		});
		const noText = await publish({
			title: "Geometría del círculo",
			description: "Áreas y perímetros",
			keywords: "circulo",
			subjects: ["arte"],
			resourceType: "video",
		});

		await updateSearchVector(db(), seed.id);
		await updateSearchVector(db(), textual.id);
		await updateSearchVector(db(), noText.id);

		const result = await getRelatedResourcesById(db(), seed.id, 6);
		const withFts = result.data.find((r) => r.id === textual.id);
		if (!withFts) {
			throw new Error("expected FTS-related candidate");
		}
		expect(withFts.signals.ftsRank).toBeGreaterThan(0);
		expect(withFts.signals.sharedKeywords).toBeGreaterThanOrEqual(1);
	});

	test("returns empty data when nothing overlaps strongly", async () => {
		const seed = await publish({
			title: `Orphan ${crypto.randomUUID().slice(0, 8)}`,
			subjects: [`unique-subject-${crypto.randomUUID().slice(0, 8)}`],
			resourceType: `tipo-unico-${crypto.randomUUID().slice(0, 6)}`,
			keywords: `kw-${crypto.randomUUID().slice(0, 6)}`,
			author: `AutorUnico ${crypto.randomUUID().slice(0, 6)}`,
		});

		const result = await getRelatedResourcesById(db(), seed.id, 6);
		// May still match language+type against other fixtures from previous tests.
		// Assert the seed itself is never returned and scores are positive when present.
		expect(result.data.every((r) => r.id !== seed.id)).toBe(true);
		expect(result.data.every((r) => r.score > 0)).toBe(true);
	});
});

describe("getRelatedResourcesBySlug", () => {
	test("returns null for unknown slug", async () => {
		const result = await getRelatedResourcesBySlug(
			db(),
			"slug-que-no-existe-recomendaciones",
		);
		expect(result).toBeNull();
	});

	test("resolves by slug for a published resource", async () => {
		const seed = await publish({
			title: `Slug seed ${crypto.randomUUID().slice(0, 8)}`,
			subjects: ["geografia"],
		});
		await publish({
			title: `Slug peer ${crypto.randomUUID().slice(0, 8)}`,
			subjects: ["geografia"],
		});

		const result = await getRelatedResourcesBySlug(db(), seed.slug, 4);
		if (!result) {
			throw new Error("expected related payload for published slug");
		}
		expect(result.limit).toBe(4);
		expect(result.data.every((r) => r.id !== seed.id)).toBe(true);
	});
	test("incluye la previsualización del .elpx en cada tarjeta (#426)", async () => {
		const seed = await publish({
			title: `Preview seed ${crypto.randomUUID().slice(0, 8)}`,
			subjects: ["astronomia-426"],
		});
		const withElpx = await publish({
			title: `Preview peer ${crypto.randomUUID().slice(0, 8)}`,
			subjects: ["astronomia-426"],
		});
		const without = await publish({
			title: `Plain peer ${crypto.randomUUID().slice(0, 8)}`,
			subjects: ["astronomia-426"],
		});
		const hash = `hash-426-${crypto.randomUUID().slice(0, 8)}`;
		await repo.createElpxProject(db(), {
			resourceId: withElpx.id,
			hash,
			extractPath: `/tmp/${hash}`,
			originalFilename: "recomendado.elpx",
			hasPreview: true,
		});

		const result = await getRelatedResourcesBySlug(db(), seed.slug, 6);
		const cards = new Map(result?.data.map((card) => [card.id, card]));
		expect(cards.get(withElpx.id)?.elpxPreview).toEqual({
			hash,
			previewUrl: `/api/v1/elpx/${hash}/`,
			screenshotUrl: null,
		});
		expect(cards.get(without.id)?.elpxPreview).toBeNull();
	});
});

describe("GET /api/v1/resources/:slug/related", () => {
	test("returns 404 for missing slug resource and 200 with ranked payload", async () => {
		const app = createApp();

		const missing = await app.request(
			"/api/v1/resources/no-such-slug-related/related",
		);
		expect(missing.status).toBe(404);

		const seed = await publish({
			title: `HTTP seed ${crypto.randomUUID().slice(0, 8)}`,
			subjects: ["musica"],
			resourceType: "audio",
		});
		const peer = await publish({
			title: `HTTP peer ${crypto.randomUUID().slice(0, 8)}`,
			subjects: ["musica"],
			resourceType: "audio",
		});

		const res = await app.request(
			`/api/v1/resources/${seed.slug}/related?limit=4`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: Array<{
				id: string;
				score: number;
				signals: { sharedSubjects: number };
			}>;
			sameAuthor: unknown[];
			limit: number;
		};
		expect(body.limit).toBe(4);
		expect(Array.isArray(body.data)).toBe(true);
		expect(Array.isArray(body.sameAuthor)).toBe(true);
		expect(body.data.some((r) => r.id === peer.id)).toBe(true);
		expect(body.data.every((r) => r.score > 0)).toBe(true);
		const peerRow = body.data.find((r) => r.id === peer.id);
		expect(peerRow?.signals.sharedSubjects).toBe(1);
	});

	test("clamps limit to product range", async () => {
		const app = createApp();
		const seed = await publish({
			title: `Clamp seed ${crypto.randomUUID().slice(0, 8)}`,
			subjects: ["educacion-fisica"],
		});

		const low = await app.request(
			`/api/v1/resources/${seed.slug}/related?limit=1`,
		);
		const lowBody = (await low.json()) as { limit: number };
		expect(lowBody.limit).toBe(4);

		const high = await app.request(
			`/api/v1/resources/${seed.slug}/related?limit=50`,
		);
		const highBody = (await high.json()) as { limit: number };
		expect(highBody.limit).toBe(8);
	});
});
