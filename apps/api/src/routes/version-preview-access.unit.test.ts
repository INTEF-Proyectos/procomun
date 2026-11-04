import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as repo from "@procomun/db/repository";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { getDb } from "../db.ts";
import { app } from "../index.ts";
import { adminRoutes } from "./admin/index.ts";

// Issue #482: la vista previa de una versión histórica se abre en un iframe
// `sandbox` de origen opaco. Como comprobó #466 en Chromium, la cookie de
// sesión solo viaja en la petición del documento inicial; los CSS, scripts,
// imágenes y subpáginas salen sin ella. Estos tests piden con sesión solo esa
// primera URL y todo lo demás sin cookies, contra la app completa.

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

const AUTHOR_ID = "autora-482";
const authorApp = createAdminApp({ id: AUTHOR_ID, role: "author" });
const strangerApp = createAdminApp({ id: "ajena-482", role: "author" });
const curatorApp = createAdminApp({ id: "curator-482", role: "curator" });
const adminApp = createAdminApp({ id: "admin-482", role: "admin" });

const originalStorageDir = process.env.UPLOAD_STORAGE_DIR;
let tmpRoot = "";
let resourceId = "";
let historicalHash = "";

async function seedVersion(label: string, fill: string): Promise<string> {
	const hash = crypto.randomUUID().replaceAll("-", "").padEnd(40, fill);
	const dir = path.join(tmpRoot, "elpx", hash);
	await mkdir(path.join(dir, "html"), { recursive: true });
	await mkdir(path.join(dir, "libs"), { recursive: true });
	await writeFile(
		path.join(dir, "index.html"),
		`<!doctype html><html><head><link rel="stylesheet" href="style.css"><script src="libs/app.js"></script></head><body><h1>${label}</h1><img src="logo.png" alt=""><a href="html/pagina2.html">2</a></body></html>`,
	);
	await writeFile(path.join(dir, "style.css"), "h1{color:navy}");
	await writeFile(path.join(dir, "libs", "app.js"), "window.ok = true;");
	await writeFile(path.join(dir, "logo.png"), "png");
	await writeFile(
		path.join(dir, "html", "pagina2.html"),
		`<!doctype html><html><head><link rel="stylesheet" href="../style.css"></head><body><p>${label} 2</p></body></html>`,
	);
	const project = await repo.createElpxProject(getDb().db, {
		resourceId,
		hash,
		extractPath: dir,
		originalFilename: `${label}.elpx`,
		hasPreview: true,
	});
	await repo.publishResourceVersion(getDb().db, {
		resourceId,
		elpxProjectId: project.id,
		createdBy: AUTHOR_ID,
	});
	return hash;
}

async function historicalPreviewUrl(client: Hono<AuthEnv>): Promise<string> {
	const res = await client.request(
		`/api/admin/resources/${resourceId}/versions`,
	);
	expect(res.status).toBe(200);
	const versions = (await res.json()) as Array<{
		isCurrent: boolean;
		previewUrl: string | null;
	}>;
	const historical = versions.find((version) => !version.isCurrent);
	expect(historical?.previewUrl).toBeTruthy();
	return historical?.previewUrl as string;
}

/**
 * Abre la vista previa como el iframe: la primera petición lleva la sesión y,
 * si redirige, el resto ya va sin cookies contra la app completa.
 */
async function openLikeTheIframe(
	client: Hono<AuthEnv>,
	previewUrl: string,
): Promise<{ url: string; res: Response }> {
	let url = previewUrl;
	let res = await client.request(url);
	for (
		let hops = 0;
		hops < 3 && res.status >= 300 && res.status < 400;
		hops++
	) {
		url = res.headers.get("location") as string;
		expect(url).toBeTruthy();
		res = await app.request(url);
	}
	return { url, res };
}

function linkedUrls(html: string): string[] {
	return [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(
		(match) => match[1] as string,
	);
}

beforeAll(async () => {
	tmpRoot = await mkdtemp(path.join(tmpdir(), "version-preview-access-"));
	process.env.UPLOAD_STORAGE_DIR = tmpRoot;
	for (const [id, role] of [
		[AUTHOR_ID, "author"],
		["ajena-482", "author"],
		["curator-482", "curator"],
		["admin-482", "admin"],
	] as const) {
		await repo.ensureUser(getDb().db, {
			id,
			email: `${id}@test.com`,
			name: id,
			role,
		});
	}
	const resource = await repo.createResource(getDb().db, {
		title: "Recurso 482 con historial",
		description: "La vista previa histórica carga sus subrecursos",
		language: "es",
		license: "cc-by",
		resourceType: "actividad-interactiva",
		createdBy: AUTHOR_ID,
	});
	resourceId = resource.id;
	// En revisión: el curator lo gestiona sin ser el curator asignado.
	await repo.updateEditorialStatus(getDb().db, resourceId, "review", "system");
	historicalHash = await seedVersion("Historica", "4");
	await seedVersion("Vigente", "8");
});

afterAll(async () => {
	if (originalStorageDir === undefined) {
		delete process.env.UPLOAD_STORAGE_DIR;
	} else {
		process.env.UPLOAD_STORAGE_DIR = originalStorageDir;
	}
	if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
});

describe("vista previa de versiones históricas sin cookies en los subrecursos (#482)", () => {
	for (const [role, client] of [
		["la autora", authorApp],
		["el curator", curatorApp],
		["el admin", adminApp],
	] as const) {
		test(`${role} la abre con estilos, scripts, imágenes y subpáginas`, async () => {
			const { url, res } = await openLikeTheIframe(
				client,
				await historicalPreviewUrl(client),
			);
			expect(res.status).toBe(200);
			const html = await res.text();
			expect(html).toContain("Historica");
			const csp = res.headers.get("content-security-policy") ?? "";
			expect(csp).toContain("sandbox");
			expect(csp).not.toContain("allow-same-origin");
			expect(res.headers.get("x-frame-options")).toBeNull();

			const links = linkedUrls(html);
			for (const file of [
				"style.css",
				"libs/app.js",
				"logo.png",
				"html/pagina2.html",
			]) {
				const link = links.find((item) => item.endsWith(`/${file}`));
				expect(link).toBeTruthy();
				// Las URL del paquete cuelgan de la misma base que el documento.
				expect(link?.startsWith(url.replace(/index\.html$/, ""))).toBe(true);
				const sub = await app.request(link as string);
				expect(sub.status).toBe(200);
			}

			// La subpágina resuelve `../style.css` contra la misma base firmada.
			const page2 = await app.request(
				links.find((item) => item.endsWith("/html/pagina2.html")) as string,
			);
			const page2Css = linkedUrls(await page2.text()).find((item) =>
				item.endsWith("/style.css"),
			);
			expect(page2Css).toBe(`${url.replace(/index\.html$/, "")}style.css`);
			expect((await app.request(page2Css as string)).status).toBe(200);
		});
	}

	test("sin acceso, ni el historial ni la vista previa dan el enlace", async () => {
		expect(
			(await strangerApp.request(`/api/admin/resources/${resourceId}/versions`))
				.status,
		).toBe(403);
		const previewUrl = await historicalPreviewUrl(authorApp);
		const res = await strangerApp.request(previewUrl);
		expect(res.status).toBe(403);
		expect(res.headers.get("location")).toBeNull();
		// Sin sesión, la ruta de administración tampoco redirige.
		const anonymous = await app.request(previewUrl);
		expect([401, 403]).toContain(anonymous.status);
		expect(anonymous.headers.get("location")).toBeNull();
	});

	test("el hash histórico sigue sin servirse por la URL estable ni con un token alterado", async () => {
		expect((await app.request(`/api/v1/elpx/${historicalHash}/`)).status).toBe(
			404,
		);
		const { url } = await openLikeTheIframe(
			authorApp,
			await historicalPreviewUrl(authorApp),
		);
		const token = url.split("/").at(-2) as string;
		const tampered = `${token.slice(0, -2)}${token.endsWith("AA") ? "BB" : "AA"}`;
		expect(
			(await app.request(`/api/v1/elpx/preview/${historicalHash}/${tampered}/`))
				.status,
		).toBe(404);
	});
});
