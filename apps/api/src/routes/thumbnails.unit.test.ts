import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createThumbnailRoutes } from "./thumbnails.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FILE = `${"a".repeat(64)}.png`;

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

// #409: miniaturas legacy copiadas a nuestro almacenamiento.
describe("GET /api/v1/thumbnails/:file", () => {
	const app = () => createThumbnailRoutes(() => storageDir);

	test("sirve la miniatura con su tipo y sin que el navegador lo adivine", async () => {
		const res = await app().request(`/${FILE}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("image/png");
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(res.headers.get("Cache-Control")).toContain("immutable");
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
	});

	test("404 si no existe", async () => {
		const res = await app().request(`/${"b".repeat(64)}.png`);
		expect(res.status).toBe(404);
	});

	test("solo acepta nombres sha256 con extensión de imagen", async () => {
		for (const name of [
			"secreto.txt",
			"..%2Fsecreto.txt",
			`${"a".repeat(64)}.svg`,
			`${"a".repeat(63)}.png`,
		]) {
			expect((await app().request(`/${name}`)).status).toBe(404);
		}
	});
});
