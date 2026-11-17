import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as repo from "@procomun/db/repository";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { getDb } from "../db.ts";
import { buildElpxPreview } from "../elpx/preview.ts";
import { app } from "../index.ts";
import { adminRoutes } from "./admin/index.ts";

// Issue #466: el contenido del .elpx por hash solo se sirve sin más si el
// recurso está publicado. Para lo demás, quien tiene acceso recibe un enlace
// firmado que funciona sin cookies dentro del iframe de origen opaco.

function createAdminApp(mockUser: Record<string, unknown>) {
	const adminApp = new Hono<AuthEnv>();
	adminApp.use("*", async (c, next) => {
		c.set("user", mockUser as AuthEnv["Variables"]["user"]);
		c.set("session", { id: "s" } as AuthEnv["Variables"]["session"]);
		await next();
	});
	adminApp.route("/api/admin", adminRoutes);
	return adminApp;
}

const AUTHOR_ID = "autora-466";
const authorApp = createAdminApp({ id: AUTHOR_ID, role: "author" });
const strangerApp = createAdminApp({ id: "ajena-466", role: "author" });
const curatorApp = createAdminApp({ id: "curator-466", role: "curator" });
const adminApp = createAdminApp({ id: "admin-466", role: "admin" });

const originalStorageDir = process.env.UPLOAD_STORAGE_DIR;
let tmpRoot = "";

type Seeded = { resourceId: string; hash: string; slug: string };
const seeded: Record<"draft" | "review" | "published", Seeded> = {
	draft: { resourceId: "", hash: "", slug: "" },
	review: { resourceId: "", hash: "", slug: "" },
	published: { resourceId: "", hash: "", slug: "" },
};

async function seedResource(status: keyof typeof seeded): Promise<Seeded> {
	const resource = await repo.createResource(getDb().db, {
		title: `Recurso 466 ${status}`,
		description: "Contenido del paquete según el estado",
		language: "es",
		license: "cc-by",
		resourceType: "actividad-interactiva",
		createdBy: AUTHOR_ID,
	});
	if (status !== "draft") {
		await repo.updateEditorialStatus(getDb().db, resource.id, status, "system");
	}
	const hash = crypto.randomUUID().replaceAll("-", "").padEnd(40, "6");
	const dir = path.join(tmpRoot, "elpx", hash);
	await mkdir(path.join(dir, "html"), { recursive: true });
	await writeFile(
		path.join(dir, "index.html"),
		`<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Paquete ${status}</h1><a href="html/pagina2.html">2</a></body></html>`,
	);
	await writeFile(path.join(dir, "style.css"), "h1{color:navy}");
	await writeFile(path.join(dir, "html", "pagina2.html"), "<p>Página 2</p>");
	const project = await repo.createElpxProject(getDb().db, {
		resourceId: resource.id,
		hash,
		extractPath: dir,
		originalFilename: `${status}.elpx`,
		hasPreview: true,
	});
	await repo.publishResourceVersion(getDb().db, {
		resourceId: resource.id,
		elpxProjectId: project.id,
		createdBy: AUTHOR_ID,
	});
	return { resourceId: resource.id, hash, slug: resource.slug as string };
}

async function adminPreviewUrl(
	client: Hono<AuthEnv>,
	resourceId: string,
): Promise<string> {
	const res = await client.request(`/api/admin/resources/${resourceId}/elpx`);
	expect(res.status).toBe(200);
	const body = (await res.json()) as { previewUrl: string | null };
	expect(body.previewUrl).not.toBeNull();
	return body.previewUrl as string;
}

beforeAll(async () => {
	tmpRoot = await mkdtemp(path.join(tmpdir(), "elpx-content-access-"));
	process.env.UPLOAD_STORAGE_DIR = tmpRoot;
	for (const [id, role] of [
		[AUTHOR_ID, "author"],
		["ajena-466", "author"],
		["curator-466", "curator"],
		["admin-466", "admin"],
	] as const) {
		await repo.ensureUser(getDb().db, {
			id,
			email: `${id}@test.com`,
			name: id,
			role,
		});
	}
	seeded.draft = await seedResource("draft");
	seeded.review = await seedResource("review");
	seeded.published = await seedResource("published");
});

afterAll(async () => {
	if (originalStorageDir === undefined) {
		delete process.env.UPLOAD_STORAGE_DIR;
	} else {
		process.env.UPLOAD_STORAGE_DIR = originalStorageDir;
	}
	if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

describe("contenido .elpx por hash según el estado del recurso (#466)", () => {
	test("el hash de un borrador responde 404 por la ruta pública", async () => {
		const { hash } = seeded.draft;
		expect((await app.request(`/api/v1/elpx/${hash}/`)).status).toBe(404);
		expect((await app.request(`/api/v1/elpx/${hash}/style.css`)).status).toBe(
			404,
		);
	});

	test("el hash de un recurso en revisión responde 404 por la ruta pública", async () => {
		const { hash } = seeded.review;
		expect((await app.request(`/api/v1/elpx/${hash}/`)).status).toBe(404);
	});

	test("un hash sin proyecto asociado no se sirve", async () => {
		const orphan = "f".repeat(40);
		await mkdir(path.join(tmpRoot, "elpx", orphan), { recursive: true });
		await writeFile(path.join(tmpRoot, "elpx", orphan, "index.html"), "x");
		expect((await app.request(`/api/v1/elpx/${orphan}/`)).status).toBe(404);
	});

	test("un recurso publicado se sigue sirviendo igual, también para incrustarlo", async () => {
		const { hash, resourceId, slug } = seeded.published;
		const res = await app.request(`/api/v1/elpx/${hash}/`);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain(`/api/v1/elpx/${hash}/style.css`);
		expect(res.headers.get("access-control-allow-origin")).toBe("*");

		// La ficha y la edición siguen dando la URL estable, sin token.
		expect(await adminPreviewUrl(authorApp, resourceId)).toBe(
			`/api/v1/elpx/${hash}/`,
		);
		const detail = await app.request(`/api/v1/resources/${slug}`);
		const body = (await detail.json()) as {
			elpxPreview: { previewUrl: string } | null;
		};
		expect(body.elpxPreview?.previewUrl).toBe(`/api/v1/elpx/${hash}/`);
	});

	test("la autora recibe un enlace firmado que carga sin cookies, con subrecursos y subpáginas", async () => {
		const { hash, resourceId } = seeded.draft;
		const previewUrl = await adminPreviewUrl(authorApp, resourceId);
		expect(previewUrl).toMatch(
			new RegExp(`^/api/v1/elpx/preview/${hash}/[^/]+/$`),
		);

		const html = await app.request(previewUrl);
		expect(html.status).toBe(200);
		const text = await html.text();
		expect(text).toContain(`${previewUrl}style.css`);
		expect(text).toContain(`${previewUrl}html/pagina2.html`);
		expect(html.headers.get("content-security-policy")).toContain("sandbox");
		expect(html.headers.get("content-security-policy")).not.toContain(
			"allow-same-origin",
		);

		expect((await app.request(`${previewUrl}style.css`)).status).toBe(200);
		expect((await app.request(`${previewUrl}html/pagina2.html`)).status).toBe(
			200,
		);
	});

	test("el curator y el admin reciben el enlace firmado de un recurso en revisión", async () => {
		const { hash, resourceId } = seeded.review;
		for (const client of [curatorApp, adminApp]) {
			const previewUrl = await adminPreviewUrl(client, resourceId);
			expect(previewUrl.startsWith(`/api/v1/elpx/preview/${hash}/`)).toBe(true);
			expect((await app.request(previewUrl)).status).toBe(200);
		}
	});

	test("el historial de versiones también firma la versión vigente de un borrador", async () => {
		const { hash, resourceId } = seeded.draft;
		const res = await authorApp.request(
			`/api/admin/resources/${resourceId}/versions`,
		);
		const versions = (await res.json()) as Array<{
			isCurrent: boolean;
			previewUrl: string | null;
		}>;
		const current = versions.find((version) => version.isCurrent);
		expect(
			current?.previewUrl?.startsWith(`/api/v1/elpx/preview/${hash}/`),
		).toBe(true);
	});

	test("un usuario sin acceso no obtiene el enlace firmado", async () => {
		const res = await strangerApp.request(
			`/api/admin/resources/${seeded.draft.resourceId}/elpx`,
		);
		expect(res.status).toBe(403);
	});

	test("un token alterado o de otro hash responde 404", async () => {
		const draftUrl = await adminPreviewUrl(authorApp, seeded.draft.resourceId);
		const token = draftUrl.split("/").at(-2) as string;
		const tampered = `${token.slice(0, -2)}${token.endsWith("AA") ? "BB" : "AA"}`;
		expect(
			(
				await app.request(
					`/api/v1/elpx/preview/${seeded.draft.hash}/${tampered}/`,
				)
			).status,
		).toBe(404);
		expect(
			(
				await app.request(
					`/api/v1/elpx/preview/${seeded.review.hash}/${token}/`,
				)
			).status,
		).toBe(404);
	});
});

// Revisión de #471: un paquete con screenshot.png en la raíz y sin index.html
// tiene miniatura, pero no visor. La API da la miniatura y no inventa un iframe.
describe("miniatura de un paquete sin index.html (#471)", () => {
	const WORD = "capturasinvisor471";
	const shotOnly: Record<"published" | "draft", Seeded> = {
		published: { resourceId: "", hash: "", slug: "" },
		draft: { resourceId: "", hash: "", slug: "" },
	};

	async function seedScreenshotOnly(
		status: keyof typeof shotOnly,
	): Promise<Seeded> {
		const resource = await repo.createResource(getDb().db, {
			title: `Recurso ${WORD} ${status}`,
			description: "Paquete con screenshot.png y sin index.html",
			language: "es",
			license: "cc-by",
			resourceType: "proyecto",
			createdBy: AUTHOR_ID,
		});
		if (status === "published") {
			await repo.updateEditorialStatus(
				getDb().db,
				resource.id,
				"published",
				"system",
				{ validationSeal: "grant" },
			);
		}
		const hash = crypto.randomUUID().replaceAll("-", "").padEnd(40, "1");
		const dir = path.join(tmpRoot, "elpx", hash);
		await mkdir(dir, { recursive: true });
		await writeFile(path.join(dir, "content.xml"), "<ode></ode>");
		await writeFile(path.join(dir, "screenshot.png"), "png");
		const project = await repo.createElpxProject(getDb().db, {
			resourceId: resource.id,
			hash,
			extractPath: dir,
			originalFilename: `${status}-sin-index.elpx`,
			hasPreview: false,
			hasScreenshot: true,
		});
		await repo.publishResourceVersion(getDb().db, {
			resourceId: resource.id,
			elpxProjectId: project.id,
			createdBy: AUTHOR_ID,
		});
		return { resourceId: resource.id, hash, slug: resource.slug as string };
	}

	beforeAll(async () => {
		shotOnly.published = await seedScreenshotOnly("published");
		shotOnly.draft = await seedScreenshotOnly("draft");
	});

	test("la ficha expone la miniatura y no ofrece visor", async () => {
		const { hash, slug } = shotOnly.published;
		const res = await app.request(`/api/v1/resources/${slug}`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { elpxPreview: unknown };
		expect(body.elpxPreview).toEqual({
			hash,
			previewUrl: null,
			screenshotUrl: `/api/v1/elpx/${hash}/screenshot.png`,
		});
	});

	test("el listado público expone la miniatura sin visor", async () => {
		const { hash, slug } = shotOnly.published;
		const res = await app.request(`/api/v1/resources?q=${WORD}`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: Array<{ slug: string; elpxPreview: unknown }>;
		};
		const card = body.data.find((item) => item.slug === slug);
		expect(card?.elpxPreview).toEqual({
			hash,
			previewUrl: null,
			screenshotUrl: `/api/v1/elpx/${hash}/screenshot.png`,
		});
	});

	test("la miniatura publicada se sirve y no hay visor detrás", async () => {
		const { hash } = shotOnly.published;
		const shot = await app.request(`/api/v1/elpx/${hash}/screenshot.png`);
		expect(shot.status).toBe(200);
		expect(shot.headers.get("content-type")).toBe("image/png");
		expect((await app.request(`/api/v1/elpx/${hash}/`)).status).toBe(404);
	});

	test("la miniatura de un borrador usa el enlace firmado y se sirve sin cookies", async () => {
		const { hash, resourceId } = shotOnly.draft;
		const project = await repo.getCurrentElpxProjectByResourceId(
			getDb().db,
			resourceId,
		);
		const preview = buildElpxPreview(project, "draft");
		expect(preview?.previewUrl).toBeNull();
		const screenshotUrl = preview?.screenshotUrl ?? "";
		expect(screenshotUrl).toMatch(
			new RegExp(`^/api/v1/elpx/preview/${hash}/[^/]+/screenshot\\.png$`),
		);
		const shot = await app.request(screenshotUrl);
		expect(shot.status).toBe(200);
		expect(shot.headers.get("content-type")).toBe("image/png");
		// Por la URL estable, el borrador sigue sin servirse (#466).
		expect(
			(await app.request(`/api/v1/elpx/${hash}/screenshot.png`)).status,
		).toBe(404);
	});

	test("la edición tampoco ofrece un visor que no existe", async () => {
		const res = await authorApp.request(
			`/api/admin/resources/${shotOnly.draft.resourceId}/elpx`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			hasPreview: boolean;
			previewUrl: string | null;
		};
		expect(body.hasPreview).toBe(false);
		expect(body.previewUrl).toBeNull();
	});
});
