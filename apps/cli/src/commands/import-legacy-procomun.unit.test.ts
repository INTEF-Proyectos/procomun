import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	findLegacySourcePairs,
	loadImportLegacyProcomunDependencies,
	runImportLegacyProcomun,
} from "./import-legacy-procomun.ts";

type Deps = Awaited<ReturnType<typeof loadImportLegacyProcomunDependencies>>;

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
			// biome-ignore lint: mock parcial del barrel de repositorio, solo se usan los dos anteriores
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
			} as Deps["repo"],
		});

		const report = await runImportLegacyProcomun({ sourceDir: dir, dryRun: false }, deps);

		expect(report.totals.processed).toBe(2);
		expect(report.totals.errored).toBe(1);
		expect(report.totals.imported).toBe(1);
	});

	test("--only filtra a un único par por nombre base", async () => {
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
