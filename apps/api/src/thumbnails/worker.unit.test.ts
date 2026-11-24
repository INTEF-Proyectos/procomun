import { describe, expect, test } from "bun:test";
import type { ThumbnailJob, ThumbnailStatus } from "@procomun/db/repository";
import type { RenderOutcome } from "./renderer.ts";
import {
	createThumbnailWorker,
	nextDelayMs,
	processThumbnailJob,
	retryDelayMs,
	runThumbnailTick,
	type ThumbnailQueue,
	type ThumbnailWorkerDeps,
} from "./worker.ts";

const NOW = new Date("2026-11-03T10:00:00.000Z");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const CONFIG = {
	concurrency: 2,
	pollIntervalMs: 15_000,
	maxAttempts: 3,
	retryBaseMs: 60_000,
	staleAfterMs: 600_000,
	unavailablePauseMs: 30_000,
};
const silent = { info() {}, warn() {}, error() {} };

type Event = [string, ...unknown[]];

/** Opciones con las que se llamó a la cola en el evento `index`. */
const optionsOf = (events: Event[], index = 0) =>
	events[index]?.[2] as { error?: string; retryable?: boolean } | undefined;

function fakeQueue(jobs: ThumbnailJob[] = []) {
	const events: Event[] = [];
	const pending = [...jobs];
	const queue: ThumbnailQueue = {
		async claim(limit, now) {
			events.push(["claim", limit, now]);
			return pending.splice(0, limit);
		},
		async recoverStale(staleBefore, maxAttempts, now) {
			events.push(["recoverStale", staleBefore, maxAttempts, now]);
			return { requeued: 0, failed: 0 };
		},
		async complete(id, file) {
			events.push(["complete", id, file]);
		},
		async markEmpty(id) {
			events.push(["markEmpty", id]);
		},
		async fail(job, options) {
			events.push(["fail", job.id, options]);
			const attempts = job.attempts + 1;
			return (
				options.retryable && attempts < options.maxAttempts
					? "pending"
					: "failed"
			) as ThumbnailStatus;
		},
		async release(id, options) {
			events.push(["release", id, options]);
		},
	};
	return { queue, events };
}

function deps(
	outcome: RenderOutcome | (() => Promise<RenderOutcome>),
	overrides: Partial<ThumbnailWorkerDeps> = {},
	jobs: ThumbnailJob[] = [],
) {
	const { queue, events } = fakeQueue(jobs);
	const rendered: string[] = [];
	const value: ThumbnailWorkerDeps = {
		queue,
		renderer: {
			async render(hash) {
				rendered.push(hash);
				return typeof outcome === "function" ? outcome() : outcome;
			},
		},
		store: async () => ({ file: `${"c".repeat(64)}.jpg` }),
		config: CONFIG,
		now: () => NOW,
		log: silent,
		...overrides,
	};
	return { deps: value, events, rendered };
}

const JOB: ThumbnailJob = { id: "p1", hash: "abc123", attempts: 0 };

describe("retryDelayMs", () => {
	test("crece por cuatro con cada intento y tiene techo", () => {
		expect(retryDelayMs(1, 60_000)).toBe(60_000);
		expect(retryDelayMs(2, 60_000)).toBe(240_000);
		expect(retryDelayMs(3, 60_000)).toBe(960_000);
		expect(retryDelayMs(30, 60_000)).toBe(6 * 60 * 60 * 1000);
	});
});

describe("processThumbnailJob (#470)", () => {
	test("guarda la imagen y marca el trabajo como hecho", async () => {
		const stored: Uint8Array[] = [];
		const { deps: d, events } = deps(
			{ kind: "image", bytes: JPEG },
			{
				store: async (bytes) => {
					stored.push(bytes);
					return { file: "f.jpg" };
				},
			},
		);

		expect(await processThumbnailJob(JOB, d)).toBe("done");
		expect(stored).toEqual([JPEG]);
		expect(events).toEqual([["complete", "p1", "f.jpg"]]);
	});

	test("una portada vacía no guarda nada", async () => {
		const { deps: d, events } = deps({ kind: "empty" });
		expect(await processThumbnailJob(JOB, d)).toBe("empty");
		expect(events).toEqual([["markEmpty", "p1"]]);
	});

	test("un fallo pasajero vuelve a la cola con su espera", async () => {
		const { deps: d, events } = deps({
			kind: "failed",
			reason: "timeout",
			retryable: true,
		});

		expect(await processThumbnailJob(JOB, d)).toBe("pending");
		expect(events).toEqual([
			[
				"fail",
				"p1",
				{
					error: "timeout",
					retryable: true,
					maxAttempts: 3,
					retryAt: new Date(NOW.getTime() + 60_000),
					now: NOW,
				},
			],
		]);
	});

	test("el último intento deja el trabajo en failed", async () => {
		const { deps: d } = deps({
			kind: "failed",
			reason: "timeout",
			retryable: true,
		});
		expect(await processThumbnailJob({ ...JOB, attempts: 2 }, d)).toBe(
			"failed",
		);
	});

	test("sanea el motivo antes de guardarlo", async () => {
		const { deps: d, events } = deps({
			kind: "failed",
			reason: "línea\r\nfalsa",
			retryable: false,
		});
		await processThumbnailJob(JOB, d);
		expect(optionsOf(events)?.error).toBe("línea??falsa");
	});

	test("con el servicio caído devuelve el trabajo sin gastar intento", async () => {
		const { deps: d, events } = deps({
			kind: "unavailable",
			reason: "ECONNREFUSED",
		});

		expect(await processThumbnailJob(JOB, d)).toBe("released");
		expect(events).toEqual([
			[
				"release",
				"p1",
				{
					retryAt: new Date(NOW.getTime() + 30_000),
					error: "ECONNREFUSED",
					now: NOW,
				},
			],
		]);
	});

	test("si el motor lanza, es un fallo pasajero", async () => {
		const { deps: d, events } = deps(async () => {
			throw new Error("boom");
		});
		expect(await processThumbnailJob(JOB, d)).toBe("pending");
		expect(events[0]?.[0]).toBe("fail");
		expect(optionsOf(events)?.retryable).toBe(true);
	});

	test("si no se puede guardar, se reintenta; si no es imagen, no", async () => {
		const diskFull = deps(
			{ kind: "image", bytes: JPEG },
			{
				store: async () => {
					throw new Error("ENOSPC");
				},
			},
		);
		expect(await processThumbnailJob(JOB, diskFull.deps)).toBe("pending");
		expect(optionsOf(diskFull.events)?.error).toContain("ENOSPC");

		const notImage = deps(
			{ kind: "image", bytes: JPEG },
			{ store: async () => null },
		);
		expect(await processThumbnailJob(JOB, notImage.deps)).toBe("failed");
	});
});

describe("runThumbnailTick (#470)", () => {
	test("recupera los colgados, reclama según la concurrencia y procesa el lote", async () => {
		const jobs = [
			{ id: "p1", hash: "h1", attempts: 0 },
			{ id: "p2", hash: "h2", attempts: 0 },
			{ id: "p3", hash: "h3", attempts: 0 },
		];
		const {
			deps: d,
			events,
			rendered,
		} = deps({ kind: "image", bytes: JPEG }, {}, jobs);

		const result = await runThumbnailTick(d);

		expect(events[0]).toEqual([
			"recoverStale",
			new Date(NOW.getTime() - 600_000),
			3,
			NOW,
		]);
		expect(events[1]).toEqual(["claim", 2, NOW]);
		expect(rendered).toEqual(["h1", "h2"]);
		expect(result).toEqual({
			claimed: 2,
			results: ["done", "done"],
			unavailable: false,
		});
	});

	test("informa de que el servicio no responde", async () => {
		const { deps: d } = deps({ kind: "unavailable", reason: "x" }, {}, [JOB]);
		expect((await runThumbnailTick(d)).unavailable).toBe(true);
	});
});

describe("nextDelayMs", () => {
	test("sigue sin pausa con el lote lleno y espera si no hay trabajo", () => {
		const full = { claimed: 2, results: [], unavailable: false };
		const partial = { claimed: 1, results: [], unavailable: false };
		const down = { claimed: 1, results: [], unavailable: true };
		expect(nextDelayMs(full, CONFIG)).toBe(0);
		expect(nextDelayMs(partial, CONFIG)).toBe(15_000);
		expect(nextDelayMs(down, CONFIG)).toBe(30_000);
		expect(nextDelayMs(null, CONFIG)).toBe(15_000);
	});
});

describe("createThumbnailWorker (#470)", () => {
	test("da vueltas hasta que se para y sobrevive a un error", async () => {
		const sleeps: number[] = [];
		let ticks = 0;
		const { queue } = fakeQueue();
		const worker = createThumbnailWorker({
			queue: {
				...queue,
				async claim() {
					ticks++;
					if (ticks === 1) throw new Error("db caída");
					return [];
				},
			},
			renderer: { render: async () => ({ kind: "empty" }) },
			store: async () => null,
			config: CONFIG,
			now: () => NOW,
			log: silent,
			sleep: async (ms, signal) => {
				sleeps.push(ms);
				if (sleeps.length >= 3) {
					await new Promise<void>((resolve) =>
						signal.addEventListener("abort", () => resolve(), { once: true }),
					);
				}
			},
		});

		expect(worker.running).toBe(false);
		worker.start();
		worker.start(); // no arranca dos bucles
		expect(worker.running).toBe(true);
		while (sleeps.length < 3) await Bun.sleep(1);
		await worker.stop();

		expect(worker.running).toBe(false);
		expect(ticks).toBe(3);
		expect(sleeps).toEqual([15_000, 15_000, 15_000]);
	});

	test("la espera por defecto termina al parar el bucle", async () => {
		const { queue } = fakeQueue();
		const worker = createThumbnailWorker({
			queue,
			renderer: { render: async () => ({ kind: "empty" }) },
			store: async () => null,
			config: { ...CONFIG, pollIntervalMs: 60 * 60 * 1000 },
			log: silent,
		});
		worker.start();
		await Bun.sleep(5);
		const started = Date.now();
		await worker.stop();
		expect(Date.now() - started).toBeLessThan(1000);
	});

	test("avisa una vez si el servicio no responde y otra cuando vuelve", async () => {
		const job = (id: string) => ({ id, hash: id, attempts: 0 }) as ThumbnailJob;
		const { queue } = fakeQueue([job("a"), job("b"), job("c")]);
		const outcomes: RenderOutcome[] = [
			{ kind: "unavailable", reason: "servicio no disponible (ECONNREFUSED)" },
			{ kind: "unavailable", reason: "servicio no disponible (ECONNREFUSED)" },
			{ kind: "empty" },
		];
		const logs: string[] = [];
		let sleeps = 0;
		const worker = createThumbnailWorker({
			queue,
			renderer: {
				render: async () => outcomes.shift() ?? { kind: "empty" },
			},
			store: async () => null,
			config: { ...CONFIG, concurrency: 1 },
			now: () => NOW,
			log: {
				info: (message: string) => logs.push(`info ${message}`),
				warn: (message: string) => logs.push(`warn ${message}`),
				error() {},
			},
			sleep: async (_ms, signal) => {
				sleeps++;
				if (sleeps >= 3) {
					await new Promise<void>((resolve) =>
						signal.addEventListener("abort", () => resolve(), { once: true }),
					);
				}
			},
		});

		worker.start();
		while (sleeps < 3) await Bun.sleep(1);
		await worker.stop();

		expect(logs).toEqual([
			"warn [thumbnails] el servicio thumbnailer no responde: las capturas quedan en cola y se reintenta cada 30 s",
			"info [thumbnails] el servicio thumbnailer vuelve a responder",
		]);
	});
});
