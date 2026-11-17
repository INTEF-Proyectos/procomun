import { describe, expect, test } from "bun:test";
import {
	type ElpxThumbnailDeps,
	formatElpxThumbnailReport,
	parseElpxThumbnailArgs,
	runElpxThumbnailBackfill,
} from "./elpx-thumbnails.ts";

const CANDIDATES = [
	{ id: "nuevo-1", status: null },
	{ id: "pendiente", status: "pending" },
	{ id: "nuevo-2", status: "skipped" },
	{ id: "en-curso", status: "processing" },
	{ id: "hecho", status: "done" },
	{ id: "fallido", status: "failed" },
	{ id: "vacio", status: "empty" },
	{ id: "nuevo-3", status: null },
];

function buildDeps() {
	const enqueued: string[][] = [];
	const deps: ElpxThumbnailDeps = {
		listCandidates: async () => CANDIDATES,
		enqueue: async (ids) => {
			enqueued.push(ids);
			return ids.length;
		},
		countStatuses: async () => ({ pending: 4, done: 1 }),
	};
	return { deps, enqueued };
}

const BASE = { dryRun: false, limit: null, force: false };

// #470: relleno solo de lo que no tiene imagen, reanudable.
describe("runElpxThumbnailBackfill", () => {
	test("encola los que nunca se capturaron y deja los demás", async () => {
		const { deps, enqueued } = buildDeps();

		const report = await runElpxThumbnailBackfill(BASE, deps);

		expect(enqueued).toEqual([["nuevo-1", "nuevo-2", "nuevo-3"]]);
		expect(report).toEqual({
			dryRun: false,
			candidates: 8,
			inQueue: 2,
			done: 1,
			notRetried: 2,
			selected: 3,
			queued: 3,
			totals: { pending: 4, done: 1 },
		});
	});

	test("--limit encola por orden y la siguiente pasada sigue", async () => {
		const { deps, enqueued } = buildDeps();
		const report = await runElpxThumbnailBackfill({ ...BASE, limit: 2 }, deps);
		expect(enqueued).toEqual([["nuevo-1", "nuevo-2"]]);
		expect(report.selected).toBe(2);
	});

	test("--force vuelve a intentar los fallidos y los vacíos", async () => {
		const { deps, enqueued } = buildDeps();
		const report = await runElpxThumbnailBackfill(
			{ ...BASE, force: true },
			deps,
		);
		expect(enqueued).toEqual([
			["nuevo-1", "nuevo-2", "fallido", "vacio", "nuevo-3"],
		]);
		expect(report.notRetried).toBe(0);
	});

	test("--dry-run cuenta sin escribir", async () => {
		const { deps, enqueued } = buildDeps();
		const report = await runElpxThumbnailBackfill(
			{ ...BASE, dryRun: true },
			deps,
		);
		expect(enqueued).toEqual([]);
		expect(report.selected).toBe(3);
		expect(report.queued).toBe(0);
	});

	test("el informe da los totales por estado", () => {
		const lines = formatElpxThumbnailReport({
			dryRun: true,
			candidates: 8,
			inQueue: 2,
			done: 1,
			notRetried: 2,
			selected: 3,
			queued: 0,
			totals: { pending: 4, done: 1 },
		});
		expect(lines).toEqual([
			"[elpx:thumbnails] (dry-run) sin_imagen=8 en_cola=2 hechos=1 sin_reintentar=2 seleccionados=3 encolados=0",
			"[elpx:thumbnails] estados: done=1 pending=4",
		]);
		expect(
			formatElpxThumbnailReport({
				dryRun: false,
				candidates: 0,
				inQueue: 0,
				done: 0,
				notRetried: 0,
				selected: 0,
				queued: 0,
				totals: {},
			})[1],
		).toBe("[elpx:thumbnails] estados: sin proyectos");
	});
});

describe("parseElpxThumbnailArgs", () => {
	test("reconoce --dry-run, --limit y --force", () => {
		expect(parseElpxThumbnailArgs([])).toEqual(BASE);
		expect(
			parseElpxThumbnailArgs(["--dry-run", "--limit", "50", "--force"]),
		).toEqual({ dryRun: true, limit: 50, force: true });
	});

	test("rechaza un límite no válido y argumentos desconocidos", () => {
		expect(() => parseElpxThumbnailArgs(["--limit"])).toThrow("--limit");
		expect(() => parseElpxThumbnailArgs(["--limit", "0"])).toThrow("--limit");
		expect(() => parseElpxThumbnailArgs(["--limit", "2.5"])).toThrow("--limit");
		expect(() => parseElpxThumbnailArgs(["--otro"])).toThrow("--otro");
	});
});
