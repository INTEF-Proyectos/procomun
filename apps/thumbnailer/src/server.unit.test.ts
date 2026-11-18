import { describe, expect, test } from "bun:test";
import { BrowserLaunchError } from "./browser-pool.ts";
import type { CaptureResult } from "./capture.ts";
import { createThumbnailerHandler, HASH_PATTERN, Limiter } from "./server.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const silent = { warn() {} };

function handler(
	render: (hash: string) => Promise<CaptureResult>,
	limiter = new Limiter(2, 2),
) {
	return createThumbnailerHandler({ render, limiter, log: silent });
}

const post = (body: string, path = "/render") =>
	new Request(`http://thumbnailer${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body,
	});

describe("servidor del thumbnailer (#470)", () => {
	test("/health responde con la ocupación", async () => {
		const response = await handler(async () => ({ status: "empty" }))(
			new Request("http://thumbnailer/health"),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			status: "ok",
			active: 0,
			queued: 0,
		});
		const wrong = await handler(async () => ({ status: "empty" }))(
			post("{}", "/health"),
		);
		expect(wrong.status).toBe(405);
	});

	test("devuelve el JPEG de la captura", async () => {
		const seen: string[] = [];
		const response = await handler(async (hash) => {
			seen.push(hash);
			return { status: "ok", bytes: JPEG, quality: 80 };
		})(post(JSON.stringify({ hash: "abc12345" })));

		expect(seen).toEqual(["abc12345"]);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("image/jpeg");
		expect(response.headers.get("X-Thumbnail-Quality")).toBe("80");
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);
	});

	test("traduce cada resultado a su código", async () => {
		const cases: Array<[CaptureResult, number]> = [
			[{ status: "empty" }, 422],
			[{ status: "not_found", message: "x" }, 404],
			[{ status: "timeout", message: "x" }, 504],
			[{ status: "error", message: "x" }, 500],
		];
		for (const [result, code] of cases) {
			const response = await handler(async () => result)(
				post(JSON.stringify({ hash: "abc12345" })),
			);
			expect(response.status).toBe(code);
			expect(((await response.json()) as { status: string }).status).toBe(
				result.status,
			);
		}
		const crashed = await handler(async () => {
			throw new Error("boom");
		})(post(JSON.stringify({ hash: "abc12345" })));
		expect(crashed.status).toBe(500);
		expect(await crashed.json()).toEqual({ status: "error", message: "boom" });
	});

	test("rechaza hashes que no son de un paquete y cuerpos raros", async () => {
		const render = async (): Promise<CaptureResult> => {
			throw new Error("no debería llamarse");
		};
		for (const body of [
			"no es json",
			JSON.stringify({ hash: "../../etc" }),
			JSON.stringify({ hash: "abc" }),
			JSON.stringify({ hash: 12345678 }),
			JSON.stringify({ hash: "a".repeat(2000) }),
		]) {
			const response = await handler(render)(post(body));
			expect(response.status).toBe(400);
		}
		expect(HASH_PATTERN.test("8f14e45f-ceea-467a-9575-6d7f1b2a3c4d")).toBe(
			true,
		);
		expect(HASH_PATTERN.test("a".repeat(64))).toBe(true);
	});

	test("solo POST /render; lo demás es 404 o 405", async () => {
		const h = handler(async () => ({ status: "empty" }));
		expect((await h(new Request("http://thumbnailer/render"))).status).toBe(
			405,
		);
		expect((await h(new Request("http://thumbnailer/otra"))).status).toBe(404);
	});

	test("con todo ocupado responde 503 y no encola sin límite", async () => {
		let release: () => void = () => {};
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const h = handler(async () => {
			await blocked;
			return { status: "empty" };
		}, new Limiter(1, 1));

		const first = h(post(JSON.stringify({ hash: "abc12345" })));
		const second = h(post(JSON.stringify({ hash: "abc12345" })));
		await Bun.sleep(1);
		const third = await h(post(JSON.stringify({ hash: "abc12345" })));
		expect(third.status).toBe(503);
		expect(await third.json()).toEqual({ status: "busy" });

		release();
		expect((await first).status).toBe(422);
		expect((await second).status).toBe(422);
	});
});

describe("Chromium que no arranca (#470)", () => {
	test("/health responde 503 con el motivo", async () => {
		const h = createThumbnailerHandler({
			render: async () => ({ status: "empty" }),
			limiter: new Limiter(1, 1),
			browserError: () => "No usable sandbox!",
			log: silent,
		});
		const response = await h(new Request("http://thumbnailer/health"));
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			status: "browser",
			message: "No usable sandbox!",
		});
	});

	test("/render responde 503 unavailable para que la API no gaste intentos", async () => {
		const response = await handler(async () => {
			throw new BrowserLaunchError("Executable doesn't exist");
		})(post(JSON.stringify({ hash: "abc12345" })));
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			status: "unavailable",
			message: "Executable doesn't exist",
		});
	});
});

describe("Limiter", () => {
	test("deja pasar hasta el máximo y da turno a los que esperan", async () => {
		const limiter = new Limiter(1, 5);
		const a = await limiter.acquire();
		const pending = limiter.acquire();
		expect(limiter.stats).toEqual({ active: 1, queued: 1 });
		a?.();
		const b = await pending;
		expect(limiter.stats).toEqual({ active: 1, queued: 0 });
		b?.();
		expect(limiter.stats).toEqual({ active: 0, queued: 0 });
	});
});
