import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElpxPreviewToken } from "../elpx/preview-token.ts";
import {
	buildSignedThumbnailUrl,
	createThumbnailToken,
} from "../thumbnails/access.ts";
import {
	createThumbnailRoutes,
	type ThumbnailVisibility,
} from "./thumbnails.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FILE = `${"a".repeat(64)}.png`;
const MISSING = `${"b".repeat(64)}.png`;
const SIGNED_BASE = "/signed";

let storageDir: string;

beforeAll(async () => {
	storageDir = await mkdtemp(path.join(tmpdir(), "thumbnails-route-"));
	await mkdir(path.join(storageDir, "thumbnails"), { recursive: true });
	await writeFile(path.join(storageDir, "thumbnails", FILE), PNG);
	await writeFile(path.join(storageDir, "secreto.txt"), "no");
});

afterAll(async () => {
	await rm(storageDir, { recursive: true, force: true });
});

function app(visibility: ThumbnailVisibility | null) {
	const asked: string[] = [];
	const routes = createThumbnailRoutes({
		getStorageDir: () => storageDir,
		getVisibility: async (file) => {
			asked.push(file);
			return visibility;
		},
	});
	return { routes, asked };
}

/** La ruta se monta en /api/v1/thumbnails: aquí se pide sin ese prefijo. */
function signedPath(file: string, nowMs?: number) {
	return buildSignedThumbnailUrl(file, nowMs).replace("/api/v1/thumbnails", "");
}

// #409: miniaturas legacy copiadas a nuestro almacenamiento. Revisión de #481:
// la URL estable solo sirve lo que pertenece a un recurso publicado.
describe("GET /api/v1/thumbnails/:file", () => {
	test("sirve la miniatura de un recurso publicado con caché pública de una hora, no inmutable", async () => {
		const { routes, asked } = app("public");
		const res = await routes.request(`/${FILE}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/png");
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
		expect(asked).toEqual([FILE]);
	});

	test("404 si el fichero solo pertenece a recursos no publicados, igual que si no existiera", async () => {
		const missing = await app("public").routes.request(`/${MISSING}`);
		const unpublished = await app("private").routes.request(`/${FILE}`);
		const orphan = await app(null).routes.request(`/${FILE}`);
		expect(missing.status).toBe(404);
		expect(unpublished.status).toBe(404);
		expect(orphan.status).toBe(404);
		const body = await missing.text();
		expect(await unpublished.text()).toBe(body);
		expect(await orphan.text()).toBe(body);
	});

	test("solo acepta nombres sha256 con extensión de imagen, sin consultar la base de datos", async () => {
		const { routes, asked } = app("public");
		for (const name of [
			"secreto.txt",
			"..%2Fsecreto.txt",
			`${"a".repeat(64)}.svg`,
			`${"a".repeat(63)}.png`,
		]) {
			expect((await routes.request(`/${name}`)).status).toBe(404);
		}
		expect(asked).toEqual([]);
	});
});

describe("GET /api/v1/thumbnails/signed/:token/:file", () => {
	test("sirve la miniatura de un recurso no publicado sin guardarla en ninguna caché", async () => {
		const res = await app("private").routes.request(signedPath(FILE));
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/png");
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(res.headers.get("Cache-Control")).toBe("private, no-store");
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
	});

	test("también vale si el recurso ya está publicado: la firma es la credencial", async () => {
		const res = await app("public").routes.request(signedPath(FILE));
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toBe("private, no-store");
	});

	test("404 si el fichero no pertenece a ningún recurso o no está en el almacén", async () => {
		expect((await app(null).routes.request(signedPath(FILE))).status).toBe(404);
		expect(
			(await app("private").routes.request(signedPath(MISSING))).status,
		).toBe(404);
	});

	test("rechaza un token caducado, alterado, de otro fichero o de la vista previa del paquete", async () => {
		const { routes, asked } = app("private");
		const expired = createThumbnailToken(FILE, Date.now() - 3 * 60 * 60 * 1000);
		const valid = createThumbnailToken(FILE);
		const [exp, sig] = valid.split(".") as [string, string];
		const flipped = `${exp}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`;
		for (const token of [
			expired,
			flipped,
			createThumbnailToken(MISSING),
			createElpxPreviewToken(FILE),
			"basura",
		]) {
			expect(
				(await routes.request(`${SIGNED_BASE}/${token}/${FILE}`)).status,
			).toBe(404);
		}
		expect(asked).toEqual([]);
	});

	test("solo acepta nombres sha256 con extensión de imagen", async () => {
		const { routes } = app("private");
		for (const name of ["secreto.txt", `${"a".repeat(64)}.svg`]) {
			const token = createThumbnailToken(name);
			expect(
				(await routes.request(`${SIGNED_BASE}/${token}/${name}`)).status,
			).toBe(404);
		}
	});
});
