import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as repo from "@procomun/db/repository";
import { getDb } from "./db.ts";
import { app } from "./index.ts";

let publishedSlug: string;
let draftSlug: string;
let videoSlug: string;
let englishSlug: string;
let publishedUploadId: string;
let publishedElpxSlug: string;
let publishedElpxUploadId: string;
let publishedCollectionSlug: string;
/** Se guarda aparte del env var (que sigue siendo el que lee la app bajo
 * prueba) para disponer del directorio ya tipado como string. */
let uploadStorageDir: string;

beforeAll(async () => {
	uploadStorageDir = await mkdtemp(
		path.join(tmpdir(), "procomun-public-uploads-"),
	);
	process.env.UPLOAD_STORAGE_DIR = uploadStorageDir;

	const draft = await repo.createResource(getDb().db, {
		title: "Recurso borrador test",
		description: "Este recurso está en borrador",
		language: "es",
		license: "cc-by",
		resourceType: "documento",
	});
	draftSlug = draft.slug;

	const pub = await repo.createResource(getDb().db, {
		title: "Recurso publicado test",
		description: "Este recurso está publicado",
		language: "es",
		license: "cc-by",
		resourceType: "documento",
	});
	publishedSlug = pub.slug;
	await repo.updateEditorialStatus(getDb().db, pub.id, "published", "system", {
		validationSeal: "grant",
	});
	publishedUploadId = `public-upload-${crypto.randomUUID()}`;
	await writeFile(
		path.join(uploadStorageDir, publishedUploadId),
		"pdf de prueba",
	);
	await repo.ensureUser(getDb().db, {
		id: "system",
		email: "system@local.invalid",
		name: "System",
		role: "admin",
	});
	await repo.createUploadSession(getDb().db, {
		id: publishedUploadId,
		resourceId: pub.id,
		ownerId: "system",
		originalFilename: "guia-publica.pdf",
		mimeType: "application/pdf",
		storageKey: `resource/${pub.id}/${publishedUploadId}/guia-publica.pdf`,
		declaredSize: 13,
	});
	const media = await repo.createMediaItem(getDb().db, {
		resourceId: pub.id,
		type: "file",
		mimeType: "application/pdf",
		url: `/api/v1/uploads/${publishedUploadId}/content`,
		fileSize: 13,
		filename: "guia-publica.pdf",
	});
	await repo.completeUploadSession(getDb().db, publishedUploadId, {
		receivedBytes: 13,
		publicUrl: `/api/v1/uploads/${publishedUploadId}/content`,
		mediaItemId: media.id,
		finalChecksum: "checksum",
	});

	const video = await repo.createResource(getDb().db, {
		title: "Video publicado test",
		description: "Recurso de video publicado",
		language: "es",
		license: "cc-by-sa",
		resourceType: "video",
	});
	videoSlug = video.slug;
	await repo.updateEditorialStatus(
		getDb().db,
		video.id,
		"published",
		"system",
		{ validationSeal: "grant" },
	);

	const english = await repo.createResource(getDb().db, {
		title: "English lesson resource",
		description: "Published english resource",
		language: "en",
		license: "cc0",
		resourceType: "documento",
	});
	englishSlug = english.slug;
	await repo.updateEditorialStatus(
		getDb().db,
		english.id,
		"published",
		"system",
		{ validationSeal: "grant" },
	);

	const publishedElpx = await repo.createResource(getDb().db, {
		title: "Recurso eXe publicado test",
		description: "Recurso publicado con proyecto eXe",
		language: "es",
		license: "cc-by",
		resourceType: "actividad-interactiva",
	});
	publishedElpxSlug = publishedElpx.slug;
	await repo.updateEditorialStatus(
		getDb().db,
		publishedElpx.id,
		"published",
		"system",
		{ validationSeal: "grant" },
	);
	publishedElpxUploadId = `public-elpx-${crypto.randomUUID()}`;
	await writeFile(
		path.join(uploadStorageDir, publishedElpxUploadId),
		"elpx de prueba",
	);
	await repo.createUploadSession(getDb().db, {
		id: publishedElpxUploadId,
		resourceId: publishedElpx.id,
		ownerId: "system",
		originalFilename: "recurso-publicado.elpx",
		mimeType: "application/zip",
		storageKey: `resource/${publishedElpx.id}/${publishedElpxUploadId}/recurso-publicado.elpx`,
		declaredSize: 13,
	});
	const elpxMedia = await repo.createMediaItem(getDb().db, {
		resourceId: publishedElpx.id,
		type: "file",
		mimeType: "application/zip",
		url: `/api/v1/uploads/${publishedElpxUploadId}/content`,
		fileSize: 13,
		filename: "recurso-publicado.elpx",
		isPrimary: true,
	});
	await repo.completeUploadSession(getDb().db, publishedElpxUploadId, {
		receivedBytes: 13,
		publicUrl: `/api/v1/uploads/${publishedElpxUploadId}/content`,
		mediaItemId: elpxMedia.id,
		finalChecksum: "checksum-elpx",
	});
	await repo.createElpxProject(getDb().db, {
		resourceId: publishedElpx.id,
		hash: "hash-public-elpx",
		extractPath: "/tmp/hash-public-elpx",
		originalFilename: "recurso-publicado.elpx",
		uploadSessionId: publishedElpxUploadId,
		version: 3,
		hasPreview: true,
	});

	const collection = await repo.createCollection(getDb().db, {
		title: "Colección pública test",
		description: "Colección publicada para la API pública",
		coverImageUrl: "https://example.com/cover-test.jpg",
		curatorId: "system",
		editorialStatus: "published",
	});
	publishedCollectionSlug = collection.slug;
	await repo.addResourceToCollection(getDb().db, collection.id, pub.id, 0);
	await repo.addResourceToCollection(getDb().db, collection.id, english.id, 1);
});

describe("Endpoints básicos", () => {
	test("GET /health devuelve status ok", async () => {
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toEqual({ status: "ok" });
	});

	test("GET / devuelve info de la API", async () => {
		const res = await app.request("/");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.name).toBe("Procomun API");
	});
});

describe("Config /api/v1/config", () => {
	test("GET /api/v1/config devuelve oidcEnabled y oidcEndSessionUrl", async () => {
		const res = await app.request("/api/v1/config");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(typeof body.oidcEnabled).toBe("boolean");
		expect("oidcEndSessionUrl" in body).toBe(true);
	});
});

describe("Rutas públicas /api/v1", () => {
	test("GET /api/v1/resources devuelve data y total", async () => {
		const res = await app.request("/api/v1/resources");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body.data)).toBe(true);
		expect(typeof body.total).toBe("number");
	});

	test("GET /api/v1/resources solo devuelve recursos publicados", async () => {
		const res = await app.request("/api/v1/resources");
		const body = await res.json();
		const slugs = body.data.map((r: { slug: string }) => r.slug);
		expect(slugs).toContain(publishedSlug);
		expect(slugs).not.toContain(draftSlug);
	});

	test("GET /api/v1/resources/:slug devuelve 404 para slug inexistente", async () => {
		const res = await app.request("/api/v1/resources/no-existe-xyz");
		expect(res.status).toBe(404);
	});

	test("GET /api/v1/resources/:slug devuelve 404 para recurso no publicado", async () => {
		const res = await app.request(`/api/v1/resources/${draftSlug}`);
		expect(res.status).toBe(404);
	});

	test("GET /api/v1/resources/:slug devuelve recurso publicado", async () => {
		const res = await app.request(`/api/v1/resources/${publishedSlug}`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.slug).toBe(publishedSlug);
		expect(body.subjects).toBeDefined();
		expect(body.levels).toBeDefined();
		expect(Array.isArray(body.mediaItems)).toBe(true);
		expect(body.mediaItems[0]?.url).toBe(
			`/api/v1/uploads/${publishedUploadId}/content`,
		);
	});

	test("GET /api/v1/resources/:slug expone elpxFileUrl cuando existe proyecto eXe", async () => {
		const res = await app.request(`/api/v1/resources/${publishedElpxSlug}`);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.slug).toBe(publishedElpxSlug);
		expect(body.elpxFileUrl).toBe(
			`/api/v1/uploads/${publishedElpxUploadId}/content`,
		);
		expect(body.elpxPreview?.previewUrl).toBe("/api/v1/elpx/hash-public-elpx/");
	});

	test("GET /api/v1/uploads/:id/content descarga archivo de recurso publicado", async () => {
		const res = await app.request(
			`/api/v1/uploads/${publishedUploadId}/content`,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("application/pdf");
		expect(res.headers.get("content-disposition")).toContain(
			'filename="guia-publica.pdf"',
		);
		expect(await res.text()).toBe("pdf de prueba");
	});

	test("GET /api/v1/resources?q= filtra por búsqueda", async () => {
		const res = await app.request("/api/v1/resources?q=publicado");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body.data)).toBe(true);
	});

	test("GET /api/v1/resources?resourceType= filtra por tipo", async () => {
		const res = await app.request("/api/v1/resources?resourceType=video");
		expect(res.status).toBe(200);
		const body = await res.json();
		const slugs = body.data.map((r: { slug: string }) => r.slug);
		expect(slugs).toContain(videoSlug);
		expect(slugs).not.toContain(publishedSlug);
	});

	test("GET /api/v1/resources?language= filtra por idioma", async () => {
		const res = await app.request("/api/v1/resources?language=en");
		expect(res.status).toBe(200);
		const body = await res.json();
		const slugs = body.data.map((r: { slug: string }) => r.slug);
		expect(slugs).toContain(englishSlug);
		expect(slugs).not.toContain(publishedSlug);
	});

	test("GET /api/v1/resources?license= filtra por licencia", async () => {
		const res = await app.request("/api/v1/resources?license=cc0");
		expect(res.status).toBe(200);
		const body = await res.json();
		const slugs = body.data.map((r: { slug: string }) => r.slug);
		expect(slugs).toContain(englishSlug);
		expect(slugs).not.toContain(videoSlug);
	});

	test("GET /api/v1/resources filtra por categoría educativa sin duplicar y la ficha muestra la clasificación", async () => {
		const both = await repo.createResource(getDb().db, {
			title: "Régimen especial música y danza",
			description: "Recurso de régimen especial",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			editorialStatus: "published",
			educationalAreas: [
				{ categoryId: "ensenanzas-regimen-especial", optionId: "musica" },
				{ categoryId: "ensenanzas-regimen-especial", optionId: "danza" },
			],
		});
		const categoryOnly = await repo.createResource(getDb().db, {
			title: "Régimen especial sin opción",
			description: "Solo la categoría",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			editorialStatus: "published",
			educationalAreas: [
				{ categoryId: "ensenanzas-regimen-especial", optionId: null },
			],
		});
		const ele = await repo.createResource(getDb().db, {
			title: "ELE avanzado en inglés",
			description: "Nivel avanzado",
			language: "en",
			license: "cc-by",
			resourceType: "documento",
			editorialStatus: "published",
			educationalAreas: [{ categoryId: "ele", optionId: "avanzado" }],
		});
		// #568: el listado público solo enseña lo validado.
		for (const { id } of [both, categoryOnly, ele]) {
			await repo.updateEditorialStatus(getDb().db, id, "published", "system", {
				validationSeal: "grant",
			});
		}

		const byCategory = await app.request(
			"/api/v1/resources?educationalCategory=ensenanzas-regimen-especial&language=es",
		);
		const categoryBody = await byCategory.json();
		const categorySlugs = categoryBody.data.map(
			(row: { slug: string }) => row.slug,
		);
		expect(categorySlugs.filter((slug: string) => slug === both.slug)).toEqual([
			both.slug,
		]);
		expect(categorySlugs).toContain(categoryOnly.slug);

		const byMusic = await app.request(
			"/api/v1/resources?educationalCategory=ensenanzas-regimen-especial&educationalOption=musica",
		);
		const musicBody = await byMusic.json();
		expect(musicBody.data.map((row: { slug: string }) => row.slug)).toEqual([
			both.slug,
		]);

		const detail = await app.request(`/api/v1/resources/${both.slug}`);
		const detailBody = await detail.json();
		// Orden del catálogo: Música va antes que Danza.
		expect(detailBody.educationalAreas).toEqual([
			{ categoryId: "ensenanzas-regimen-especial", optionId: "musica" },
			{ categoryId: "ensenanzas-regimen-especial", optionId: "danza" },
		]);
	});

	test("GET /api/v1/resources combina texto y filtros", async () => {
		const res = await app.request(
			"/api/v1/resources?q=English&language=en&license=cc0",
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		const slugs = body.data.map((r: { slug: string }) => r.slug);
		expect(slugs).toContain(englishSlug);
		expect(
			body.data.every(
				(r: { language: string; license: string }) =>
					r.language === "en" && r.license === "cc0",
			),
		).toBe(true);
	});

	test("GET /api/v1/collections devuelve lista", async () => {
		const res = await app.request("/api/v1/collections");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body.data)).toBe(true);
		expect(body.data[0]?.resourceCount).toBeGreaterThan(0);
		expect(
			body.data.some(
				(item: { slug: string }) => item.slug === publishedCollectionSlug,
			),
		).toBe(true);
	});

	test("GET /api/v1/collections?q= filtra colecciones publicadas", async () => {
		const res = await app.request("/api/v1/collections?q=publica");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(
			body.data.every(
				(item: { editorialStatus: string }) =>
					item.editorialStatus === "published",
			),
		).toBe(true);
	});

	test("GET /api/v1/collections/:slug devuelve detalle con recursos", async () => {
		const res = await app.request(
			`/api/v1/collections/${publishedCollectionSlug}`,
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.slug).toBe(publishedCollectionSlug);
		expect(body.coverImageUrl).toBe("https://example.com/cover-test.jpg");
		expect(Array.isArray(body.resources)).toBe(true);
		expect(body.resources.length).toBeGreaterThan(0);
	});

	test("GET /api/v1/collections/:slug devuelve 404 si no existe", async () => {
		const res = await app.request("/api/v1/collections/no-existe");
		expect(res.status).toBe(404);
	});
});

describe("Rutas admin /api/admin — sin autenticación", () => {
	test("POST /api/admin/resources devuelve 401 sin sesión", async () => {
		const res = await app.request("/api/admin/resources", { method: "POST" });
		expect(res.status).toBe(401);
	});

	test("GET /api/admin/users devuelve 401 sin sesión", async () => {
		const res = await app.request("/api/admin/users");
		expect(res.status).toBe(401);
	});

	test("DELETE /api/admin/resources/123 devuelve 401 sin sesión", async () => {
		const res = await app.request("/api/admin/resources/123", {
			method: "DELETE",
		});
		expect(res.status).toBe(401);
	});
});
