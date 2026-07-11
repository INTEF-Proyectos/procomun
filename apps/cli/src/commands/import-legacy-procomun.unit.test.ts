import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveLegacyExternalId } from "@procomun/db/legacy-import";
import type { LegacyOdeJson } from "@procomun/db/legacy-import";
import {
	findLegacySourcePairs,
	iterateResolvedPairs,
	loadImportLegacyProcomunDependencies,
	runImportLegacyProcomun,
} from "./import-legacy-procomun.ts";

type Deps = Awaited<ReturnType<typeof loadImportLegacyProcomunDependencies>>;

async function collect<T>(iter: AsyncGenerator<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const item of iter) out.push(item);
	return out;
}

function buildMockDeps(storageDir: string, overrides: Partial<Deps> = {}): Deps {
	const base: Deps = {
		// biome-ignore lint: mock de DrizzleDB, no se usa realmente en estos tests
		getDb: () => ({ db: {} as any }),
		waitForDb: async () => {},
		processElpxUpload: (async () => ({
			hash: "mock-hash",
			extractPath: "/tmp/mock-extract",
			hasPreview: true,
			metadata: { title: "t", description: "d", author: "a", license: "l", language: "es", learningResourceType: "" },
		})) as Deps["processElpxUpload"],
		getUploadConfig: (() => ({
			// storageDir real (mkdtemp): runImportLegacyProcomun escribe aquí de
			// verdad vía Bun.write antes de llamar a processElpxUpload/repo (ambos
			// mockeados) — un storageDir vacío resolvería rutas relativas al cwd
			// del proceso de test y escribiría fuera del sandbox.
			storageDir,
			maxFileSizeBytes: 0,
			maxFilesPerBatch: 0,
			maxConcurrentPerUser: 0,
			chunkSizeBytes: 0,
			sessionTtlMs: 0,
			allowedMimeTypes: [],
			allowedExtensions: [],
		})) as Deps["getUploadConfig"],
		ensureUploadStorageDir: async () => {},
		computeFileSha256: (async () => "mock-checksum") as Deps["computeFileSha256"],
		buildUploadPublicUrl: ((id: string) => `/api/v1/uploads/${id}/content`) as Deps["buildUploadPublicUrl"],
		sanitizeFilename: ((f: string) => f) as Deps["sanitizeFilename"],
		removeElpxExtraction: (async () => {}) as Deps["removeElpxExtraction"],
		updateSearchVector: (async () => {}) as Deps["updateSearchVector"],
		// Implementación real (no mockeada): es pura y los fixtures de estos
		// tests son JSON vacíos "{}", así que resuelve "" y cada par cae al
		// fallback por baseName, preservando la identidad distinta de cada par
		// que esperan los tests existentes.
		resolveLegacyExternalId,
		mapLegacyRecord: (() => ({
			externalId: "es_mock",
			blocking: false,
			blockingErrors: [],
			warnings: [],
			resource: {
				externalId: "es_mock",
				importSource: "legacy-procomun",
				sourceUri: null,
				title: "Mock",
				description: "Mock description",
				language: "es",
				license: "cc-by",
				resourceType: "documento",
				subjects: [],
				levels: [],
				author: null,
				publisher: null,
				keywords: null,
				importedAt: null,
			},
		})) as Deps["mapLegacyRecord"],
		ensureLegacyImportSystemUser: (async () => ({ id: "system-user", email: "x@x.test" })) as Deps["ensureLegacyImportSystemUser"],
		repo: {
			findLegacyResourceByExternalId: async () => null,
			importLegacyResourceWithElpx: async () => ({
				resourceId: "mock-resource-id",
				slug: "mock-slug",
				mediaItemId: "mock-media-id",
				elpxProjectId: "mock-elpx-id",
			}),
			getElpxProjectByHash: async () => null,
			// biome-ignore lint: mock parcial del barrel de repositorio, solo se usan las anteriores
		} as Deps["repo"],
	};

	return { ...base, ...overrides };
}

describe("findLegacySourcePairs", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "legacy-pairs-"));
		await writeFile(path.join(dir, "a.json"), "{}");
		await writeFile(path.join(dir, "a.elpx"), "zip-bytes");
		await writeFile(path.join(dir, "b.json"), "{}"); // sin .elpx pareja
		await writeFile(path.join(dir, "c.elpx"), "zip-bytes"); // sin .json pareja
		await writeFile(path.join(dir, "readme.txt"), "ignorar"); // extensión irrelevante
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	test("empareja por nombre base e informa de las entradas incompletas", async () => {
		const { pairs, incomplete } = await findLegacySourcePairs(dir);

		expect(pairs).toHaveLength(1);
		expect(pairs[0]?.baseName).toBe("a");
		expect(incomplete.sort()).toEqual(["b", "c"]);
	});
});

describe("iterateResolvedPairs", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "legacy-resolve-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	test("resuelve el externalId del JSON aunque difiera del nombre del fichero", async () => {
		// El nombre de fichero exportado no siempre coincide con idODE (solo
		// ocurre así en la muestra observada) — iterateResolvedPairs debe leer el JSON.
		await writeFile(
			path.join(dir, "nombre-de-fichero-cualquiera.json"),
			JSON.stringify({ idODE: "es_externo_real" }),
		);
		await writeFile(path.join(dir, "nombre-de-fichero-cualquiera.elpx"), "zip-bytes");

		const { pairs } = await findLegacySourcePairs(dir);
		const resolved = await collect(iterateResolvedPairs(pairs, resolveLegacyExternalId));

		expect(resolved).toHaveLength(1);
		expect(resolved[0]?.externalId).toBe("es_externo_real");
		expect(resolved[0]?.parseError).toBeUndefined();
	});

	test("captura un JSON malformado como parseError sin lanzar, con fallback al nombre de fichero", async () => {
		await writeFile(path.join(dir, "corrupto.json"), "{ esto no es JSON válido");
		await writeFile(path.join(dir, "corrupto.elpx"), "zip-bytes");
		await writeFile(path.join(dir, "valido.json"), JSON.stringify({ idODE: "es_valido" }));
		await writeFile(path.join(dir, "valido.elpx"), "zip-bytes");

		const { pairs } = await findLegacySourcePairs(dir);
		const resolved = await collect(iterateResolvedPairs(pairs, resolveLegacyExternalId));

		const corrupted = resolved.find((r) => r.pair.baseName === "corrupto");
		expect(corrupted?.parseError).toBeTruthy();
		expect(corrupted?.externalId).toBe("corrupto");

		const valid = resolved.find((r) => r.pair.baseName === "valido");
		expect(valid?.parseError).toBeUndefined();
		expect(valid?.externalId).toBe("es_valido");
	});

	test("cae al nombre de fichero cuando el JSON es válido pero no trae idODE/id", async () => {
		await writeFile(path.join(dir, "sin-id.json"), JSON.stringify({ titleStr: "Sin identificador" }));
		await writeFile(path.join(dir, "sin-id.elpx"), "zip-bytes");

		const { pairs } = await findLegacySourcePairs(dir);
		const resolved = await collect(iterateResolvedPairs(pairs, resolveLegacyExternalId));

		expect(resolved[0]?.externalId).toBe("sin-id");
		expect(resolved[0]?.parseError).toBeUndefined();
	});

	test("es perezoso: no lee/resuelve pares más allá de los que el consumidor pide (no escala mal con --limit)", async () => {
		// Regresión del hallazgo P1 de la revisión del PR #268: con un array
		// precomputado, `--limit 1` sobre ~78.800 recursos igualmente leería y
		// parsearía los 78.800 JSON antes de recortar a 1. Con el generador, el
		// consumidor puede dejar de pedir elementos y los restantes nunca se
		// tocan — se comprueba contando cuántas veces se invoca el resolver de
		// externalId (inyectado), que solo se llama una vez por par realmente leído.
		await writeFile(path.join(dir, "a.json"), JSON.stringify({ idODE: "a" }));
		await writeFile(path.join(dir, "a.elpx"), "zip-bytes");
		await writeFile(path.join(dir, "b.json"), JSON.stringify({ idODE: "b" }));
		await writeFile(path.join(dir, "b.elpx"), "zip-bytes");
		await writeFile(path.join(dir, "c.json"), JSON.stringify({ idODE: "c" }));
		await writeFile(path.join(dir, "c.elpx"), "zip-bytes");

		const { pairs } = await findLegacySourcePairs(dir);
		expect(pairs).toHaveLength(3);

		let resolveCalls = 0;
		const spyResolve = (json: LegacyOdeJson) => {
			resolveCalls++;
			return resolveLegacyExternalId(json);
		};

		const iterator = iterateResolvedPairs(pairs, spyResolve);
		const first = await iterator.next();
		const second = await iterator.next();
		// Deliberadamente NO se pide un tercer elemento.
		expect(first.done).toBe(false);
		expect(second.done).toBe(false);
		expect(resolveCalls).toBe(2);
	});
});

describe("runImportLegacyProcomun (deps mockeadas)", () => {
	let dir: string;
	let storageDir: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "legacy-run-"));
		storageDir = await mkdtemp(path.join(tmpdir(), "legacy-run-storage-"));
		await writeFile(path.join(dir, "es_mock.json"), "{}");
		await writeFile(path.join(dir, "es_mock.elpx"), "fake-zip-bytes");
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
		await rm(storageDir, { recursive: true, force: true });
	});

	test("un registro bloqueante no llama a processElpxUpload ni a importLegacyResourceWithElpx", async () => {
		let processCalled = false;
		let importCalled = false;
		const deps = buildMockDeps(storageDir, {
			mapLegacyRecord: (() => ({
				externalId: "es_mock",
				blocking: true,
				blockingErrors: ["licencia no reconocida"],
				warnings: [],
				resource: {} as any,
			})) as Deps["mapLegacyRecord"],
			processElpxUpload: (async () => {
				processCalled = true;
				throw new Error("no debería llamarse");
			}) as Deps["processElpxUpload"],
			repo: {
				findLegacyResourceByExternalId: async () => null,
				importLegacyResourceWithElpx: async () => {
					importCalled = true;
					throw new Error("no debería llamarse");
				},
			} as Deps["repo"],
		});

		const report = await runImportLegacyProcomun({ sourceDir: dir, dryRun: false }, deps);

		expect(report.totals.blocked).toBe(1);
		expect(report.totals.imported).toBe(0);
		expect(report.records[0]).toMatchObject({ outcome: "blocked" });
		expect(processCalled).toBe(false);
		expect(importCalled).toBe(false);
	});

	test("un recurso ya existente se omite sin volver a importar", async () => {
		let importCalled = false;
		const deps = buildMockDeps(storageDir, {
			repo: {
				findLegacyResourceByExternalId: async () => ({ id: "existing-id", slug: "existing" }),
				importLegacyResourceWithElpx: async () => {
					importCalled = true;
					throw new Error("no debería llamarse");
				},
			} as Deps["repo"],
		});

		const report = await runImportLegacyProcomun({ sourceDir: dir, dryRun: false }, deps);

		expect(report.totals.skippedExisting).toBe(1);
		expect(report.totals.imported).toBe(0);
		expect(importCalled).toBe(false);
	});

	test("--dry-run no llama a processElpxUpload ni a importLegacyResourceWithElpx", async () => {
		let processCalled = false;
		let importCalled = false;
		const deps = buildMockDeps(storageDir, {
			processElpxUpload: (async () => {
				processCalled = true;
				throw new Error("no debería llamarse en dry-run");
			}) as Deps["processElpxUpload"],
			repo: {
				findLegacyResourceByExternalId: async () => null,
				importLegacyResourceWithElpx: async () => {
					importCalled = true;
					throw new Error("no debería llamarse en dry-run");
				},
			} as Deps["repo"],
		});

		const report = await runImportLegacyProcomun({ sourceDir: dir, dryRun: true }, deps);

		expect(report.dryRun).toBe(true);
		expect(report.totals.imported).toBe(1);
		expect(report.records[0]).toMatchObject({ outcome: "would_import" });
		expect(processCalled).toBe(false);
		expect(importCalled).toBe(false);
	});

	test("un registro importable llama a processElpxUpload y persiste vía el repositorio", async () => {
		const deps = buildMockDeps(storageDir);
		const report = await runImportLegacyProcomun({ sourceDir: dir, dryRun: false }, deps);

		expect(report.totals.imported).toBe(1);
		expect(report.records[0]).toMatchObject({ outcome: "imported", resourceId: "mock-resource-id" });
	});

	test("un fallo al persistir se cuenta como error y no aborta el resto del lote", async () => {
		await writeFile(path.join(dir, "otro.json"), "{}");
		await writeFile(path.join(dir, "otro.elpx"), "fake-zip-bytes");

		let calls = 0;
		const deps = buildMockDeps(storageDir, {
			mapLegacyRecord: ((json: unknown, fallbackTitle: string) => ({
				externalId: fallbackTitle,
				blocking: false,
				blockingErrors: [],
				warnings: [],
				resource: {
					externalId: fallbackTitle,
					importSource: "legacy-procomun",
					sourceUri: null,
					title: fallbackTitle,
					description: "d",
					language: "es",
					license: "cc-by",
					resourceType: "documento",
					subjects: [],
					levels: [],
					author: null,
					publisher: null,
					keywords: null,
					importedAt: null,
				},
			})) as Deps["mapLegacyRecord"],
			repo: {
				findLegacyResourceByExternalId: async () => null,
				importLegacyResourceWithElpx: async () => {
					calls++;
					if (calls === 1) throw new Error("fallo simulado en el primer registro");
					return {
						resourceId: "mock-resource-id-2",
						slug: "mock-slug-2",
						mediaItemId: "mock-media-id-2",
						elpxProjectId: "mock-elpx-id-2",
					};
				},
				getElpxProjectByHash: async () => null,
			} as Deps["repo"],
		});

		const report = await runImportLegacyProcomun({ sourceDir: dir, dryRun: false }, deps);

		expect(report.totals.processed).toBe(2);
		expect(report.totals.errored).toBe(1);
		expect(report.totals.imported).toBe(1);
	});

	test("un .json malformado se reporta como error sin abortar el resto del lote", async () => {
		await writeFile(path.join(dir, "es_mock.json"), "{ esto no es JSON válido");
		await writeFile(path.join(dir, "otro.json"), "{}");
		await writeFile(path.join(dir, "otro.elpx"), "fake-zip-bytes");

		const deps = buildMockDeps(storageDir);
		const report = await runImportLegacyProcomun({ sourceDir: dir, dryRun: false }, deps);

		expect(report.totals.processed).toBe(2);
		expect(report.totals.errored).toBe(1);
		expect(report.totals.imported).toBe(1);
		const errorRecord = report.records.find((r) => r.outcome === "error");
		expect(errorRecord?.externalId).toBe("es_mock");
		expect((errorRecord as { message?: string })?.message).toContain("JSON");
	});

	test("--only filtra por el externalId resuelto del JSON (aquí coincide con el nombre base)", async () => {
		await writeFile(path.join(dir, "otro.json"), "{}");
		await writeFile(path.join(dir, "otro.elpx"), "fake-zip-bytes");

		const deps = buildMockDeps(storageDir);
		const report = await runImportLegacyProcomun({ sourceDir: dir, dryRun: false, only: "es_mock" }, deps);

		expect(report.totals.pairsFound).toBe(2);
		expect(report.totals.processed).toBe(1);
	});

	test("--limit limita el número de pares procesados", async () => {
		await writeFile(path.join(dir, "otro.json"), "{}");
		await writeFile(path.join(dir, "otro.elpx"), "fake-zip-bytes");

		const deps = buildMockDeps(storageDir);
		const report = await runImportLegacyProcomun({ sourceDir: dir, dryRun: false, limit: 1 }, deps);

		expect(report.totals.pairsFound).toBe(2);
		expect(report.totals.processed).toBe(1);
	});
});
