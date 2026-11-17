/**
 * API HTTP interna del servicio `thumbnailer` (#470, ADR-0046). Solo la
 * alcanza `app` por la red interna de Docker.
 *
 *   GET  /health          → 200 { status: "ok", active, queued }
 *                           503 { status: "browser" } si Chromium no arranca
 *   POST /render {hash}   → 200 image/jpeg (640×400)
 *                           422 empty · 404 not_found · 400 invalid
 *                           504 timeout · 500 error
 *                           503 busy (cola llena) · 503 unavailable (Chromium)
 */
import { BrowserLaunchError } from "./browser-pool.ts";
import type { CaptureResult } from "./capture.ts";

// El mismo patrón que la API acepta para los hashes de elpx_projects.
export const HASH_PATTERN = /^[a-f0-9-]{8,64}$/i;
const MAX_BODY_BYTES = 1024;

export type RenderFn = (hash: string) => Promise<CaptureResult>;

/** Limita las capturas a la vez y cuántas pueden esperar turno. */
export class Limiter {
	private active = 0;
	private waiting: Array<() => void> = [];

	constructor(
		private readonly max: number,
		private readonly queueLimit: number,
	) {}

	get stats() {
		return { active: this.active, queued: this.waiting.length };
	}

	/** `null` si está lleno: el que llama responde 503. */
	async acquire(): Promise<(() => void) | null> {
		if (this.active < this.max) {
			this.active++;
			return () => this.next();
		}
		if (this.waiting.length >= this.queueLimit) return null;
		await new Promise<void>((resolve) => this.waiting.push(resolve));
		return () => this.next();
	}

	private next() {
		const resume = this.waiting.shift();
		if (resume) resume();
		else this.active--;
	}
}

const json = (status: number, body: Record<string, unknown>) =>
	Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const STATUS_CODES: Record<Exclude<CaptureResult["status"], "ok">, number> = {
	empty: 422,
	not_found: 404,
	timeout: 504,
	error: 500,
};

async function readHash(request: Request): Promise<string | null> {
	const declared = Number(request.headers.get("Content-Length"));
	if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
	const text = await request.text();
	if (text.length > MAX_BODY_BYTES) return null;
	try {
		const body = JSON.parse(text) as { hash?: unknown };
		return typeof body.hash === "string" && HASH_PATTERN.test(body.hash)
			? body.hash
			: null;
	} catch {
		return null;
	}
}

export function createThumbnailerHandler(deps: {
	render: RenderFn;
	limiter: Limiter;
	/** Motivo por el que el navegador no arranca, o `null` si funciona. */
	browserError?: () => string | null;
	log?: Pick<typeof console, "warn">;
}) {
	return async (request: Request): Promise<Response> => {
		const { pathname } = new URL(request.url);

		if (pathname === "/health") {
			if (request.method !== "GET") return json(405, { status: "method" });
			const browserError = deps.browserError?.() ?? null;
			if (browserError) {
				return json(503, { status: "browser", message: browserError });
			}
			return json(200, { status: "ok", ...deps.limiter.stats });
		}

		if (pathname !== "/render") return json(404, { status: "not_found" });
		if (request.method !== "POST") return json(405, { status: "method" });

		const hash = await readHash(request);
		if (!hash) {
			return json(400, { status: "invalid", message: "hash no válido" });
		}

		const release = await deps.limiter.acquire();
		if (!release) return json(503, { status: "busy" });
		try {
			const result = await deps.render(hash);
			if (result.status === "ok") {
				return new Response(Buffer.from(result.bytes), {
					status: 200,
					headers: {
						"Content-Type": "image/jpeg",
						"Content-Length": String(result.bytes.byteLength),
						"Cache-Control": "no-store",
						"X-Thumbnail-Quality": String(result.quality),
					},
				});
			}
			if (result.status !== "empty") {
				deps.log?.warn(
					`[thumbnailer] ${hash}: ${result.status} (${result.message})`,
				);
			}
			return json(STATUS_CODES[result.status], {
				status: result.status,
				...("message" in result ? { message: result.message } : {}),
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (err instanceof BrowserLaunchError) {
				deps.log?.warn(`[thumbnailer] Chromium no arranca: ${message}`);
				return json(503, { status: "unavailable", message });
			}
			deps.log?.warn(`[thumbnailer] ${hash}: error (${message})`);
			return json(500, { status: "error", message });
		} finally {
			release();
		}
	};
}
