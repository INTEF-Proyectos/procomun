import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import * as repo from "@procomun/db/repository";
import * as schema from "@procomun/db/schema";
import { createTables } from "@procomun/db/setup";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { buildElpxMap, buildElpxPreview } from "../elpx/preview.ts";
import { createThumbnailRoutes } from "../routes/thumbnails.ts";
import { storeThumbnailBytes } from "../services/legacy-preview-image.ts";
import {
	createDbThumbnailQueue,
	resetThumbnailWorkerForTests,
	startThumbnailWorkerFromEnv,
} from "./start.ts";
import { runThumbnailTick, type ThumbnailWorker } from "./worker.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
const CONFIG = {
	concurrency: 2,
	pollIntervalMs: 15_000,
	maxAttempts: 3,
	retryBaseMs: 60_000,
	staleAfterMs: 600_000,
	unavailablePauseMs: 60_000,
};
const silent = { info() {}, warn() {}, error() {} };

// Base propia: la del preload la comparten todos los tests y el bucle
// reclamaría proyectos de otros ficheros.
let pglite: PGlite;
let db: repo.DrizzleDB;
let storageDir: string;

beforeAll(async () => {
	pglite = new PGlite();
	await createTables(pglite);
	db = drizzle(pglite, { schema });
	storageDir = await mkdtemp(path.join(tmpdir(), "thumbs-start-"));
}, 60_000);

afterAll(async () => {
	await pglite?.close();
	if (storageDir) await rm(storageDir, { recursive: true, force: true });
});

describe("bucle de miniaturas contra la base de datos (#470)", () => {
	test("un paquete sin imagen sale de la cola con su miniatura servida", async () => {
		const resource = await repo.createResource(db, {
			title: "Sin imagen",
			description: "",
			language: "es",
			license: "cc-by",
			resourceType: "proyecto",
		});
		const project = await repo.createElpxProject(db, {
			resourceId: resource.id,
			hash: "sinimagen01",
			extractPath: "/tmp/sinimagen01",
			originalFilename: "a.elpx",
			hasPreview: true,
		});
		const rendered: string[] = [];

		const result = await runThumbnailTick({
			queue: createDbThumbnailQueue(db),
			renderer: {
				async render(hash) {
					rendered.push(hash);
					return { kind: "image", bytes: JPEG };
				},
			},
			store: (bytes) => storeThumbnailBytes(storageDir, bytes),
			config: CONFIG,
			log: silent,
		});

		expect(rendered).toEqual(["sinimagen01"]);
		expect(result).toEqual({
			claimed: 1,
			results: ["done"],
			unavailable: false,
		});
		const [row] = await db
			.select()
			.from(schema.elpxProjects)
			.where(eq(schema.elpxProjects.id, project.id));
		expect(row?.thumbnailStatus).toBe("done");
		const file = row?.thumbnailFile ?? "";
		expect(await readdir(path.join(storageDir, "thumbnails"))).toEqual([file]);

		const map = buildElpxMap(
			await repo.listElpxProjectsByResourceIds(db, [resource.id]),
		);
		const preview = buildElpxPreview(map.get(resource.id));
		expect(preview?.thumbnailUrl).toBe(`/api/v1/thumbnails/${file}`);

		const response = await createThumbnailRoutes(() => storageDir).request(
			`/${file}`,
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("image/jpeg");
		expect(response.headers.get("Cache-Control")).toContain("immutable");
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG);

		// Ya no queda nada pendiente.
		expect(await repo.claimThumbnailJobs(db, { limit: 5 })).toEqual([]);
	});
});

describe("startThumbnailWorkerFromEnv (#470)", () => {
	test("sin THUMBNAILER_URL no arranca nada", () => {
		const lines: string[] = [];
		const log = { ...silent, info: (line: string) => lines.push(line) };
		expect(
			startThumbnailWorkerFromEnv({ NODE_ENV: "production" }, { log }),
		).toBeNull();
		expect(lines).toEqual([
			"[thumbnails] bucle desactivado (sin THUMBNAILER_URL)",
		]);
	});

	test("en los tests no arranca ni ensucia el log", () => {
		const lines: string[] = [];
		const log = { ...silent, info: (line: string) => lines.push(line) };
		expect(
			startThumbnailWorkerFromEnv(
				{ NODE_ENV: "test", THUMBNAILER_URL: "http://t:1" },
				{ log },
			),
		).toBeNull();
		expect(lines).toEqual([]);
	});

	test("con la URL crea un único bucle y lo arranca", async () => {
		resetThumbnailWorkerForTests();
		let starts = 0;
		const fake: ThumbnailWorker = {
			start() {
				starts++;
			},
			async stop() {},
			running: false,
		};
		const created: unknown[] = [];
		const env = { NODE_ENV: "production", THUMBNAILER_URL: "http://t:1" };
		const options = {
			log: silent,
			create: (deps: unknown) => {
				created.push(deps);
				return fake;
			},
		};
		try {
			expect(startThumbnailWorkerFromEnv(env, options)).toBe(fake);
			expect(startThumbnailWorkerFromEnv(env, options)).toBe(fake);
			expect(created).toHaveLength(1);
			while (starts === 0) await Bun.sleep(1);
			expect(starts).toBe(1);
		} finally {
			resetThumbnailWorkerForTests();
		}
	});
});
