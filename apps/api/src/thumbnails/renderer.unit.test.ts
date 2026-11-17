import { describe, expect, test } from "bun:test";
import { createHttpThumbnailRenderer, MAX_RENDERED_BYTES } from "./renderer.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 1, 2, 3]);
type Call = { url: string; init?: RequestInit };

function fakeFetch(
	handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
	const calls: Call[] = [];
	const fn = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, init });
		return handler(url, init);
	}) as typeof fetch;
	return { fn, calls };
}

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});

function renderer(fn: typeof fetch) {
	return createHttpThumbnailRenderer({
		baseUrl: "http://thumbnailer:3100/",
		timeoutMs: 1000,
		fetch: fn,
	});
}

describe("createHttpThumbnailRenderer (#470)", () => {
	test("pide la captura del hash por POST y devuelve los bytes", async () => {
		const { fn, calls } = fakeFetch(
			() => new Response(JPEG, { headers: { "Content-Type": "image/jpeg" } }),
		);

		const outcome = await renderer(fn).render("abc123");

		expect(outcome).toEqual({ kind: "image", bytes: JPEG });
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("http://thumbnailer:3100/render");
		expect(calls[0]?.init?.method).toBe("POST");
		expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
			hash: "abc123",
		});
	});

	test("rechaza una respuesta que no es imagen o que es demasiado grande", async () => {
		const notImage = fakeFetch(() => new Response("<html>"));
		expect(await renderer(notImage.fn).render("h")).toEqual({
			kind: "failed",
			reason: "la respuesta del servicio no es una imagen",
			retryable: false,
		});

		const big = new Uint8Array(MAX_RENDERED_BYTES + 1);
		big.set(JPEG);
		const tooBig = fakeFetch(() => new Response(big));
		expect(await renderer(tooBig.fn).render("h")).toMatchObject({
			kind: "failed",
			retryable: false,
		});

		const declared = fakeFetch(
			() =>
				new Response(JPEG, {
					headers: { "Content-Length": String(MAX_RENDERED_BYTES + 1) },
				}),
		);
		expect(await renderer(declared.fn).render("h")).toMatchObject({
			kind: "failed",
			retryable: false,
		});
	});

	test("traduce los estados del servicio", async () => {
		const cases: Array<[number, unknown, unknown]> = [
			[422, { status: "empty" }, { kind: "empty" }],
			[
				404,
				{ status: "not_found", message: "sin index.html" },
				{
					kind: "failed",
					reason: "not_found: sin index.html",
					retryable: false,
				},
			],
			[
				400,
				{ status: "invalid" },
				{ kind: "failed", reason: "invalid", retryable: false },
			],
			[
				504,
				{ status: "timeout" },
				{ kind: "failed", reason: "timeout", retryable: true },
			],
			[
				500,
				{ status: "error", message: "boom" },
				{ kind: "failed", reason: "error: boom", retryable: true },
			],
			[503, { status: "busy" }, { kind: "unavailable", reason: "busy" }],
		];
		for (const [status, body, expected] of cases) {
			const { fn } = fakeFetch(() => json(status, body));
			expect(await renderer(fn).render("h")).toEqual(expected as never);
		}
		const { fn } = fakeFetch(() => new Response("no json", { status: 502 }));
		expect(await renderer(fn).render("h")).toEqual({
			kind: "failed",
			reason: "HTTP 502",
			retryable: true,
		});
	});

	test("si el servicio no responde, no culpa al paquete", async () => {
		const { fn, calls } = fakeFetch(() => {
			throw new Error("ECONNREFUSED");
		});

		const outcome = await renderer(fn).render("h");

		expect(outcome).toEqual({
			kind: "unavailable",
			reason: "servicio no disponible (ECONNREFUSED)",
		});
		expect(calls.map((call) => call.url)).toEqual([
			"http://thumbnailer:3100/render",
			"http://thumbnailer:3100/health",
		]);
	});

	test("si la petición falla pero el servicio vive, cuenta como intento", async () => {
		const { fn } = fakeFetch((url) => {
			if (url.endsWith("/health")) return json(200, { status: "ok" });
			throw new Error("socket hang up");
		});

		expect(await renderer(fn).render("h")).toEqual({
			kind: "failed",
			reason: "la petición al servicio falló (socket hang up)",
			retryable: true,
		});
	});

	test("healthy consulta /health", async () => {
		const up = fakeFetch(() => json(200, { status: "ok" }));
		expect(await renderer(up.fn).healthy()).toBe(true);
		const down = fakeFetch(() => json(500, {}));
		expect(await renderer(down.fn).healthy()).toBe(false);
	});
});
