import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	copyLegacyPreviewImage,
	detectImageType,
	isAllowedPreviewImageUrl,
	THUMBNAIL_FILE_RE,
	thumbnailPath,
} from "./legacy-preview-image.ts";

const PNG = new Uint8Array([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d,
]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const GIF = new TextEncoder().encode("GIF89a....");
const WEBP = new Uint8Array([
	...new TextEncoder().encode("RIFF"),
	0,
	0,
	0,
	0,
	...new TextEncoder().encode("WEBPVP8 "),
]);
const URL_OK =
	"https://ode.educacion.es/INTEF/1416349635379/vistaPreviaAgrega.png";

function fakeFetch(
	responses: Record<string, () => Response>,
): typeof fetch & { calls: string[] } {
	const calls: string[] = [];
	const fn = (async (input: string | URL | Request) => {
		const url = String(input);
		calls.push(url);
		const make = responses[url];
		if (!make) throw new Error(`fetch inesperado: ${url}`);
		return make();
	}) as typeof fetch & { calls: string[] };
	fn.calls = calls;
	return fn;
}

let storageDir: string;

beforeAll(async () => {
	storageDir = await mkdtemp(path.join(tmpdir(), "legacy-preview-"));
});

afterAll(async () => {
	await rm(storageDir, { recursive: true, force: true });
});

// #409: la imagen preview legacy se copia a nuestro almacenamiento.
describe("detectImageType", () => {
	test("reconoce el tipo real por los primeros bytes", () => {
		expect(detectImageType(PNG)?.ext).toBe("png");
		expect(detectImageType(JPEG)?.ext).toBe("jpg");
		expect(detectImageType(GIF)?.ext).toBe("gif");
		expect(detectImageType(WEBP)?.ext).toBe("webp");
	});

	test("no acepta HTML ni SVG aunque se llamen .png", () => {
		expect(detectImageType(new TextEncoder().encode("<html>"))).toBeNull();
		expect(
			detectImageType(new TextEncoder().encode("<svg xmlns=...>")),
		).toBeNull();
	});
});

describe("isAllowedPreviewImageUrl", () => {
	test("solo ode.educacion.es por http(s)", () => {
		expect(isAllowedPreviewImageUrl(URL_OK)).toBe(true);
		expect(
			isAllowedPreviewImageUrl("http://ode.educacion.es/INTEF/1/a.png"),
		).toBe(true);
		expect(isAllowedPreviewImageUrl("https://evil.example/a.png")).toBe(false);
		expect(
			isAllowedPreviewImageUrl("https://ode.educacion.es.evil.example/a.png"),
		).toBe(false);
		expect(isAllowedPreviewImageUrl("ftp://ode.educacion.es/a.png")).toBe(
			false,
		);
		expect(isAllowedPreviewImageUrl("no es una url")).toBe(false);
	});
});

describe("copyLegacyPreviewImage", () => {
	test("descarga la imagen y la guarda con nombre por contenido", async () => {
		const fetchFn = fakeFetch({ [URL_OK]: () => new Response(PNG) });

		const result = await copyLegacyPreviewImage(URL_OK, {
			storageDir,
			fetch: fetchFn,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const file = result.url.replace("/api/v1/thumbnails/", "");
		expect(file).toMatch(THUMBNAIL_FILE_RE);
		expect(file.endsWith(".png")).toBe(true);
		expect(
			new Uint8Array(await readFile(thumbnailPath(storageDir, file))),
		).toEqual(PNG);
	});

	test("no descarga de otros hosts", async () => {
		const fetchFn = fakeFetch({});

		const result = await copyLegacyPreviewImage("https://evil.example/a.png", {
			storageDir,
			fetch: fetchFn,
		});

		expect(result).toEqual({
			ok: false,
			reason: "host no permitido",
			retryable: false,
		});
		expect(fetchFn.calls).toEqual([]);
	});

	test("rechaza un contenido que no es imagen aunque diga image/png", async () => {
		const fetchFn = fakeFetch({
			[URL_OK]: () =>
				new Response("<html>login</html>", {
					headers: { "Content-Type": "image/png" },
				}),
		});

		const result = await copyLegacyPreviewImage(URL_OK, {
			storageDir,
			fetch: fetchFn,
		});

		expect(result).toEqual({
			ok: false,
			reason: "el contenido no es una imagen PNG, JPEG, GIF o WebP",
			retryable: false,
		});
	});

	test("rechaza una imagen que supera el límite de tamaño", async () => {
		const big = new Uint8Array(64);
		big.set(PNG);
		const fetchFn = fakeFetch({ [URL_OK]: () => new Response(big) });

		const result = await copyLegacyPreviewImage(URL_OK, {
			storageDir,
			fetch: fetchFn,
			maxBytes: 32,
		});

		expect(result).toEqual({
			ok: false,
			reason: "la imagen supera 32 bytes",
			retryable: false,
		});
	});

	test("informa del estado HTTP si la descarga falla", async () => {
		const fetchFn = fakeFetch({
			[URL_OK]: () => new Response("no", { status: 404 }),
		});

		const result = await copyLegacyPreviewImage(URL_OK, {
			storageDir,
			fetch: fetchFn,
		});

		expect(result).toEqual({ ok: false, reason: "HTTP 404", retryable: false });
	});

	test("un 5xx o un fallo de red se puede reintentar", async () => {
		const fetchFn = fakeFetch({
			[URL_OK]: () => new Response("no", { status: 503 }),
		});
		expect(
			await copyLegacyPreviewImage(URL_OK, { storageDir, fetch: fetchFn }),
		).toEqual({ ok: false, reason: "HTTP 503", retryable: true });

		const failing = (async () => {
			throw new Error("ECONNRESET");
		}) as unknown as typeof fetch;
		expect(
			await copyLegacyPreviewImage(URL_OK, { storageDir, fetch: failing }),
		).toEqual({
			ok: false,
			reason: "error de red (ECONNRESET)",
			retryable: true,
		});
	});

	test("no sigue redirecciones a otros hosts", async () => {
		const fetchFn = fakeFetch({
			[URL_OK]: () =>
				new Response(null, {
					status: 302,
					headers: { Location: "https://evil.example/a.png" },
				}),
		});

		const result = await copyLegacyPreviewImage(URL_OK, {
			storageDir,
			fetch: fetchFn,
		});

		expect(result).toEqual({
			ok: false,
			reason: "redirección a un host no permitido",
			retryable: false,
		});
		expect(fetchFn.calls).toEqual([URL_OK]);
	});

	test("sigue una redirección dentro de ode.educacion.es", async () => {
		const target = "https://ode.educacion.es/INTEF/otra/vistaPreviaAgrega.png";
		const fetchFn = fakeFetch({
			[URL_OK]: () =>
				new Response(null, { status: 301, headers: { Location: target } }),
			[target]: () => new Response(JPEG),
		});

		const result = await copyLegacyPreviewImage(URL_OK, {
			storageDir,
			fetch: fetchFn,
		});

		expect(result.ok && result.url.endsWith(".jpg")).toBe(true);
		expect(await readdir(path.join(storageDir, "thumbnails"))).toContainEqual(
			expect.stringMatching(/\.jpg$/),
		);
	});
});
