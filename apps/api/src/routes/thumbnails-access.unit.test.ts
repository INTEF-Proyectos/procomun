import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as repo from "@procomun/db/repository";
import { elpxProjects, favorites, ratings } from "@procomun/db/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { auth } from "../auth/config.ts";
import type { AuthEnv } from "../auth/middleware.ts";
import { getDb } from "../db.ts";
import { buildSignedElpxPreviewUrl } from "../elpx/preview-token.ts";
import { app } from "../index.ts";
import { storeThumbnailBytes } from "../services/legacy-preview-image.ts";
import { adminRoutes } from "./admin/index.ts";

// Revisión de #481 (adenda 2026-11-03 de ADR-0046): la miniatura de un recurso
// no publicado no sale por la URL estable. Quien puede verlo recibe un enlace
// firmado; al despublicar, la URL estable deja de servirse en la petición
// siguiente.

const AUTHOR_ID = "autora-481";
const STRANGER_ID = "ajena-481";
const CURATOR_ID = "curator-481";
const ADMIN_ID = "admin-481";
const WORD = "miniaturaacceso481";
const SIGNED = /^\/api\/v1\/thumbnails\/signed\/[^/]+\/([a-f0-9]{64}\.jpg)$/;

const originalStorageDir = process.env.UPLOAD_STORAGE_DIR;
let tmpRoot = "";
let bytesCounter = 0;

type Status = "draft" | "review" | "published" | "archived";
type Seeded = {
	resourceId: string;
	slug: string;
	hash: string;
	/** Miniatura generada (#470). */
	file: string;
	/** Preview legacy (#472) en resources.thumbnail_url. */
	legacyFile: string;
};

function createAdminApp(user: { id: string; role: string }) {
	const adminApp = new Hono<AuthEnv>();
	adminApp.use("*", async (c, next) => {
		c.set("user", user as AuthEnv["Variables"]["user"]);
		c.set("session", { id: "s" } as AuthEnv["Variables"]["session"]);
		await next();
	});
	adminApp.route("/api/admin", adminRoutes);
	return adminApp;
}

/** Simula la sesión de better-auth para la ficha y /users/me. */
async function as<T>(
	user: { id: string; role: string },
	run: () => Promise<T>,
): Promise<T> {
	const getSession = spyOn(auth.api, "getSession");
	getSession.mockResolvedValue({
		user,
		session: { id: "s" },
	} as unknown as Awaited<ReturnType<typeof auth.api.getSession>>);
	try {
		return await run();
	} finally {
		getSession.mockRestore();
	}
}

const AUTHOR = { id: AUTHOR_ID, role: "author" };
const STRANGER = { id: STRANGER_ID, role: "author" };
const CURATOR = { id: CURATOR_ID, role: "curator" };

async function storeJpeg(): Promise<string> {
	bytesCounter += 1;
	const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 4, 8, 1, bytesCounter]);
	const stored = await storeThumbnailBytes(tmpRoot, bytes);
	if (!stored) throw new Error("no se guardó la miniatura de prueba");
	return stored.file;
}

async function setStatus(resourceId: string, status: Status) {
	await repo.updateEditorialStatus(getDb().db, resourceId, status, "system");
}

async function seed(status: Status, label: string = status): Promise<Seeded> {
	const db = getDb().db;
	const resource = await repo.createResource(db, {
		title: `Recurso ${WORD} ${label}`,
		description: "Miniatura según el estado editorial",
		language: "es",
		license: "cc-by",
		resourceType: "actividad-interactiva",
		createdBy: AUTHOR_ID,
	});
	if (status !== "draft") await setStatus(resource.id, status);

	const hash = crypto.randomUUID().replaceAll("-", "").padEnd(40, "8");
	const dir = path.join(tmpRoot, "elpx", hash);
	await mkdir(dir, { recursive: true });
	await writeFile(
		path.join(dir, "index.html"),
		`<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>${label}</h1></body></html>`,
	);
	await writeFile(path.join(dir, "style.css"), "h1{color:navy}");
	await writeFile(path.join(dir, "screenshot.png"), "png");
	const project = await repo.createElpxProject(db, {
		resourceId: resource.id,
		hash,
		extractPath: dir,
		originalFilename: `${label}.elpx`,
		hasPreview: true,
	});
	const file = await storeJpeg();
	await db
		.update(elpxProjects)
		.set({ thumbnailStatus: "done", thumbnailFile: file })
		.where(eq(elpxProjects.id, project.id));
	await repo.publishResourceVersion(db, {
		resourceId: resource.id,
		elpxProjectId: project.id,
		createdBy: AUTHOR_ID,
	});

	const legacyFile = await storeJpeg();
	await repo.setResourceThumbnailUrl(
		db,
		resource.id,
		`/api/v1/thumbnails/${legacyFile}`,
	);
	return {
		resourceId: resource.id,
		slug: resource.slug as string,
		hash,
		file,
		legacyFile,
	};
}

const seeded = {} as Record<Status, Seeded>;

const stable = (file: string) => `/api/v1/thumbnails/${file}`;
const get = (url: string) => app.request(url);

/** Ninguna URL estable de las miniaturas de estos recursos en el JSON. */
function expectNoStableUrl(json: unknown, ...items: Seeded[]) {
	const text = JSON.stringify(json);
	for (const item of items) {
		expect(text).not.toContain(stable(item.file));
		expect(text).not.toContain(stable(item.legacyFile));
	}
}

async function expectSignedServes(url: unknown, file: string) {
	expect(typeof url).toBe("string");
	expect(SIGNED.exec(url as string)?.[1]).toBe(file);
	const res = await get(url as string);
	expect(res.status).toBe(200);
	expect(res.headers.get("cache-control")).toBe("private, no-store");
}

beforeAll(async () => {
	tmpRoot = await mkdtemp(path.join(tmpdir(), "thumbnails-access-"));
	process.env.UPLOAD_STORAGE_DIR = tmpRoot;
	for (const [id, role] of [
		[AUTHOR_ID, "author"],
		[STRANGER_ID, "author"],
		[CURATOR_ID, "curator"],
		[ADMIN_ID, "admin"],
	] as const) {
		await repo.ensureUser(getDb().db, {
			id,
			email: `${id}@test.com`,
			name: id,
			role,
		});
	}
	for (const status of ["draft", "review", "published", "archived"] as const) {
		seeded[status] = await seed(status);
	}
});

afterAll(async () => {
	if (originalStorageDir === undefined) {
		delete process.env.UPLOAD_STORAGE_DIR;
	} else {
		process.env.UPLOAD_STORAGE_DIR = originalStorageDir;
	}
	if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

describe("URL estable de la miniatura según el estado (CA-1 a CA-4)", () => {
	for (const status of ["draft", "review", "archived"] as const) {
		test(`${status}: 404 para la generada y la legacy, con sesión o sin ella`, async () => {
			const { file, legacyFile } = seeded[status];
			expect((await get(stable(file))).status).toBe(404);
			expect((await get(stable(legacyFile))).status).toBe(404);
			await as(AUTHOR, async () => {
				expect((await get(stable(file))).status).toBe(404);
			});
		});
	}

	test("publicado: 200 con caché pública de una hora y sin immutable", async () => {
		const { file, legacyFile } = seeded.published;
		for (const name of [file, legacyFile]) {
			const res = await get(stable(name));
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toBe("image/jpeg");
			expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
		}
	});

	test("el listado público da la URL estable, sin token", async () => {
		const res = await get(`/api/v1/resources?q=${WORD}`);
		const body = (await res.json()) as {
			data: Array<{
				slug: string;
				thumbnailUrl: string | null;
				elpxPreview: { thumbnailUrl: string | null } | null;
			}>;
		};
		const card = body.data.find((item) => item.slug === seeded.published.slug);
		expect(card?.elpxPreview?.thumbnailUrl).toBe(stable(seeded.published.file));
		expect(card?.thumbnailUrl).toBe(stable(seeded.published.legacyFile));
		// Los no publicados no salen en el listado público.
		expect(body.data.map((item) => item.slug)).toEqual([seeded.published.slug]);
	});
});

describe("cambios de estado (CA-5)", () => {
	test("al archivar, la URL estable da 404 en la petición siguiente; al republicar vuelve", async () => {
		const item = await seed("published", "cambios");
		expect((await get(stable(item.file))).status).toBe(200);
		expect((await get(stable(item.legacyFile))).status).toBe(200);

		await setStatus(item.resourceId, "archived");
		expect((await get(stable(item.file))).status).toBe(404);
		expect((await get(stable(item.legacyFile))).status).toBe(404);

		await setStatus(item.resourceId, "draft");
		expect((await get(stable(item.file))).status).toBe(404);

		await setStatus(item.resourceId, "published");
		expect((await get(stable(item.file))).status).toBe(200);
		expect((await get(stable(item.legacyFile))).status).toBe(200);
	});

	test("un recurso borrado no sirve su miniatura por ninguna ruta (CA-9)", async () => {
		const item = await seed("published", "borrado");
		const signed = await as(AUTHOR, async () => {
			const res = await get(`/api/v1/resources/${item.slug}`);
			return (await res.json()) as {
				elpxPreview: { thumbnailUrl: string } | null;
			};
		});
		await setStatus(item.resourceId, "draft");
		const draft = await as(AUTHOR, async () => {
			const res = await get(`/api/v1/resources/${item.slug}`);
			return (await res.json()) as {
				elpxPreview: { thumbnailUrl: string } | null;
			};
		});
		const signedUrl = draft.elpxPreview?.thumbnailUrl as string;
		expect(signedUrl).toMatch(SIGNED);
		expect((await get(signedUrl)).status).toBe(200);

		await repo.deleteResource(getDb().db, item.resourceId);
		expect((await get(stable(item.file))).status).toBe(404);
		expect((await get(signedUrl)).status).toBe(404);
		expect(signed.elpxPreview?.thumbnailUrl).toBe(stable(item.file));
	});
});

describe("quién recibe el enlace firmado (CA-1, CA-2, CA-4)", () => {
	test("la ficha de un borrador da a su autora enlaces firmados de la generada y de la legacy", async () => {
		const item = seeded.draft;
		const body = await as(AUTHOR, async () => {
			const res = await get(`/api/v1/resources/${item.slug}`);
			expect(res.status).toBe(200);
			return (await res.json()) as {
				thumbnailUrl: string | null;
				elpxPreview: { thumbnailUrl: string | null } | null;
			};
		});
		await expectSignedServes(body.elpxPreview?.thumbnailUrl, item.file);
		await expectSignedServes(body.thumbnailUrl, item.legacyFile);
		expectNoStableUrl(body, item);
	});

	test("la ficha de un recurso en revisión: el curator recibe el enlace firmado", async () => {
		const item = seeded.review;
		const body = await as(CURATOR, async () => {
			const res = await get(`/api/v1/resources/${item.slug}`);
			expect(res.status).toBe(200);
			return (await res.json()) as {
				thumbnailUrl: string | null;
				elpxPreview: { thumbnailUrl: string | null } | null;
			};
		});
		await expectSignedServes(body.elpxPreview?.thumbnailUrl, item.file);
		await expectSignedServes(body.thumbnailUrl, item.legacyFile);
	});

	test("otra autora no ve la ficha del borrador ni, por tanto, ninguna URL", async () => {
		await as(STRANGER, async () => {
			const res = await get(`/api/v1/resources/${seeded.draft.slug}`);
			expect(res.status).toBe(404);
			expectNoStableUrl(await res.json(), seeded.draft);
		});
	});

	test("el panel de la autora firma sus recursos no publicados", async () => {
		const body = await as(AUTHOR, async () => {
			const res = await get("/api/v1/users/me/dashboard");
			expect(res.status).toBe(200);
			return (await res.json()) as {
				recentResources: Array<{
					id: string;
					elpxPreview: { thumbnailUrl: string | null } | null;
				}>;
			};
		});
		const byId = new Map(body.recentResources.map((row) => [row.id, row]));
		for (const status of ["draft", "review", "archived"] as const) {
			const row = byId.get(seeded[status].resourceId);
			await expectSignedServes(
				row?.elpxPreview?.thumbnailUrl,
				seeded[status].file,
			);
		}
		expectNoStableUrl(body, seeded.draft, seeded.review, seeded.archived);
	});

	test("favoritos y valoraciones: un recurso archivado solo lleva imagen si el usuario puede verlo", async () => {
		const db = getDb().db;
		const item = seeded.archived;
		for (const userId of [STRANGER_ID, CURATOR_ID]) {
			await db.insert(favorites).values({
				id: crypto.randomUUID(),
				userId,
				resourceId: item.resourceId,
			});
			await db.insert(ratings).values({
				id: crypto.randomUUID(),
				userId,
				resourceId: item.resourceId,
				score: 4,
			});
		}
		type Card = {
			id: string;
			elpxPreview: { thumbnailUrl: string | null } | null;
		};
		const list = async (user: typeof STRANGER, url: string) =>
			as(user, async () => {
				const res = await get(url);
				expect(res.status).toBe(200);
				return (await res.json()) as { data: Card[] };
			});

		for (const url of [
			"/api/v1/users/me/favorites",
			"/api/v1/users/me/ratings",
		]) {
			const stranger = await list(STRANGER, url);
			const strangerCard = stranger.data.find(
				(card) => card.id === item.resourceId,
			);
			expect(strangerCard).toBeDefined();
			expect(strangerCard?.elpxPreview).toBeNull();
			expectNoStableUrl(stranger, item);

			const curator = await list(CURATOR, url);
			const curatorCard = curator.data.find(
				(card) => card.id === item.resourceId,
			);
			await expectSignedServes(
				curatorCard?.elpxPreview?.thumbnailUrl,
				item.file,
			);
			expectNoStableUrl(curator, item);
		}
	});

	test("la administración firma thumbnailUrl en el listado y en el detalle", async () => {
		const authorApp = createAdminApp(AUTHOR);
		const listRes = await authorApp.request("/api/admin/resources?limit=100");
		expect(listRes.status).toBe(200);
		const list = (await listRes.json()) as {
			data: Array<{
				id: string;
				editorialStatus: string;
				thumbnailUrl: string;
			}>;
		};
		for (const status of ["draft", "review", "archived"] as const) {
			const row = list.data.find((r) => r.id === seeded[status].resourceId);
			await expectSignedServes(row?.thumbnailUrl, seeded[status].legacyFile);
		}
		const published = list.data.find(
			(r) => r.id === seeded.published.resourceId,
		);
		expect(published?.thumbnailUrl).toBe(stable(seeded.published.legacyFile));
		expectNoStableUrl(list, seeded.draft, seeded.review, seeded.archived);

		const detailRes = await authorApp.request(
			`/api/admin/resources/${seeded.draft.resourceId}`,
		);
		expect(detailRes.status).toBe(200);
		const detail = (await detailRes.json()) as { thumbnailUrl: string };
		await expectSignedServes(detail.thumbnailUrl, seeded.draft.legacyFile);
	});

	test("una autora ve sus borradores y lo publicado en su colección", async () => {
		const db = getDb().db;
		const collection = await repo.createCollection(db, {
			title: "Colección importada de la autora",
			description: "Incluye recursos con distintos permisos",
			curatorId: AUTHOR_ID,
		});
		const draft = await repo.createResource(db, {
			title: "Borrador ajeno",
			description: "Privado",
			language: "es",
			license: "cc-by",
			resourceType: "actividad-interactiva",
			createdBy: STRANGER_ID,
		});
		for (const resourceId of [
			draft.id,
			seeded.draft.resourceId,
			seeded.published.resourceId,
		]) {
			await repo.addResourceToCollection(db, collection.id, resourceId);
		}
		const response = await createAdminApp(AUTHOR).request(
			`/api/admin/collections/${collection.id}/resources`,
		);
		expect(response.status).toBe(200);
		const rows = (await response.json()) as Array<{ resourceId: string }>;
		expect(rows.map((row) => row.resourceId)).toEqual([
			seeded.draft.resourceId,
			seeded.published.resourceId,
		]);
	});

	test("las colecciones de administración ocultan el borrador ajeno", async () => {
		const db = getDb().db;
		const collection = await repo.createCollection(db, {
			title: `Colección ${WORD}`,
			description: "Con recursos no publicados",
			curatorId: CURATOR_ID,
		});
		for (const status of ["draft", "archived", "published"] as const) {
			await repo.addResourceToCollection(
				db,
				collection.id,
				seeded[status].resourceId,
			);
		}
		const res = await createAdminApp(CURATOR).request(
			`/api/admin/collections/${collection.id}/resources`,
		);
		expect(res.status).toBe(200);
		const rows = (await res.json()) as Array<{
			resourceId: string;
			thumbnailUrl: string | null;
		}>;
		const byId = new Map(rows.map((row) => [row.resourceId, row]));
		// #460: el borrador de otra persona es privado de su autora.
		expect(byId.has(seeded.draft.resourceId)).toBe(false);
		await expectSignedServes(
			byId.get(seeded.archived.resourceId)?.thumbnailUrl,
			seeded.archived.legacyFile,
		);
		expect(byId.get(seeded.published.resourceId)?.thumbnailUrl).toBe(
			stable(seeded.published.legacyFile),
		);
		expectNoStableUrl(rows, seeded.draft, seeded.archived);
	});
});

describe("screenshot.png de un recurso no publicado", () => {
	test("el enlace firmado del paquete la sirve sin caché; el resto conserva la de #483", async () => {
		const base = buildSignedElpxPreviewUrl(seeded.draft.hash);
		const shot = await get(`${base}screenshot.png`);
		expect(shot.status).toBe(200);
		expect(shot.headers.get("cache-control")).toBe("private, no-store");
		const css = await get(`${base}style.css`);
		expect(css.status).toBe(200);
		expect(css.headers.get("cache-control")).toBe("public, max-age=3600");
	});

	test("la URL estable de screenshot.png sigue con la caché pública de #483", async () => {
		const res = await get(
			`/api/v1/elpx/${seeded.published.hash}/screenshot.png`,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
		expect(
			(await get(`/api/v1/elpx/${seeded.draft.hash}/screenshot.png`)).status,
		).toBe(404);
	});
});
