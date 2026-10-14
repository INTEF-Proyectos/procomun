import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LegacyOdeJson } from "@procomun/db/legacy-import";
import { resolveLegacyExternalId } from "@procomun/db/legacy-import";
import {
	findLegacySourcePairs,
	iterateResolvedPairs,
	type loadImportLegacyProcomunDependencies,
	runBackfillLegacyEducationalAreas,
	runImportLegacyProcomun,
} from "./import-legacy-procomun.ts";

type Deps = Awaited<ReturnType<typeof loadImportLegacyProcomunDependencies>>;

async function collect<T>(iter: AsyncGenerator<T>): Promise<T[]> {
	const out: T[] = [];
	for await (const item of iter) out.push(item);
	return out;
}

function buildMockDeps(
	storageDir: string,
	overrides: Partial<Deps> = {},
): Deps {
	const base: Deps = {
		// Mock de DrizzleDB: estos tests no llegan a usar la conexión real, pero se
		// tipa contra el tipo concreto en vez de `any`.
		getDb: () =>
			({ db: {} as unknown as ReturnType<Deps["getDb"]>["db"] }) as ReturnType<
				Deps["getDb"]
			>,
		waitForDb: async () => {},
		// Réplica fiel (mismo baseDir/elpx/<hash> que buildElpxPath real) que crea
		// un directorio real con contenido: necesario para que el rename() real
		// de persistImportedResource (promoción del directorio de extracción al
		// nombre del checksum) tenga algo real que mover y falle con
		// ENOTEMPTY/EEXIST cuando corresponda, en vez de un path inventado.
		processElpxUpload: (async (
			_storagePath: string,
			baseDir: string,
			opts?: { hash?: string },
		) => {
			const hash = opts?.hash ?? "mock-hash";
			const extractPath = path.join(baseDir, "elpx", hash);
			await mkdir(extractPath, { recursive: true });
			await writeFile(path.join(extractPath, "content.xml"), "<ode/>");
			return {
				hash,
				extractPath,
				hasPreview: true,
				metadata: {
					title: "t",
					description: "d",
					author: "a",
					license: "l",
					language: "es",
					learningResourceType: "",
				},
			};
		}) as Deps["processElpxUpload"],
		buildElpxPath: ((baseDir: string, hash: string) =>
			path.join(baseDir, "elpx", hash)) as Deps["buildElpxPath"],
		getUploadConfig: (() => ({
			// storageDir real (mkdtemp): runImportLegacyProcomun escribe aquí de
			// verdad vía Bun.write antes de llamar a processElpxUpload/repo (ambos
			// mockeados) — un storageDir vacío resolvería rutas relativas al cwd
			// del proceso de test y escribiría fuera del sandbox.
			storageDir,
			maxFileSizeBytes: 0,
			maxFilesPerBatch: 0,
			maxConcurrentPerUser: 0,
			maxTotalBytesPerUser: 0,
			chunkSizeBytes: 0,
			sessionTtlMs: 0,
			allowedMimeTypes: [],
			allowedExtensions: [],
		})) as Deps["getUploadConfig"],
		ensureUploadStorageDir: async () => {},
		computeFileSha256: (async () =>
			"mock-checksum") as Deps["computeFileSha256"],
		buildUploadPublicUrl: ((id: string) =>
			`/api/v1/uploads/${id}/content`) as Deps["buildUploadPublicUrl"],
		sanitizeFilename: ((f: string) => f) as Deps["sanitizeFilename"],
		// Réplica fiel de la real (rm recursivo): con processElpxUpload creando
		// directorios reales (ver arriba), un no-op dejaría el directorio del
		// checksum ocupado tras un fallo simulado y rompería el siguiente
		// registro que reutilice el mismo mock-checksum.
		removeElpxExtraction: (async (extractPath: string) => {
			await rm(extractPath, { recursive: true, force: true });
		}) as Deps["removeElpxExtraction"],
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
		ensureLegacyImportSystemUser: async () => ({
			id: "system-user",
			email: "x@x.test",
			name: "Importador legacy Procomún",
			bio: null,
			role: "admin",
			isActive: true,
			createdAt: new Date(0),
			updatedAt: new Date(0),
		}),
		repo: {
			backfillLegacyEducationalAreas: async () => [],
			findLegacyResourceByExternalId: async () => null,
			importLegacyResourceWithElpx: async () => ({
				resourceId: "mock-resource-id",
				slug: "mock-slug",
				mediaItemId: "mock-media-id",
				elpxProjectId: "mock-elpx-id",
			}),
			getElpxProjectByHash: async () => null,
		},
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
		await writeFile(
			path.join(dir, "nombre-de-fichero-cualquiera.elpx"),
			"zip-bytes",
		);

		const { pairs } = await findLegacySourcePairs(dir);
		const resolved = await collect(
			iterateResolvedPairs(pairs, resolveLegacyExternalId),
		);

		expect(resolved).toHaveLength(1);
		expect(resolved[0]?.externalId).toBe("es_externo_real");
		expect(resolved[0]?.parseError).toBeUndefined();
	});

	test("captura un JSON malformado como parseError sin lanzar, con fallback al nombre de fichero", async () => {
		await writeFile(
			path.join(dir, "corrupto.json"),
			"{ esto no es JSON válido",
		);
		await writeFile(path.join(dir, "corrupto.elpx"), "zip-bytes");
		await writeFile(
			path.join(dir, "valido.json"),
			JSON.stringify({ idODE: "es_valido" }),
		);
		await writeFile(path.join(dir, "valido.elpx"), "zip-bytes");

		const { pairs } = await findLegacySourcePairs(dir);
		const resolved = await collect(
			iterateResolvedPairs(pairs, resolveLegacyExternalId),
		);

		const corrupted = resolved.find((r) => r.pair.baseName === "corrupto");
		expect(corrupted?.parseError).toBeTruthy();
		expect(corrupted?.externalId).toBe("corrupto");

		const valid = resolved.find((r) => r.pair.baseName === "valido");
		expect(valid?.parseError).toBeUndefined();
		expect(valid?.externalId).toBe("es_valido");
	});

	test("cae al nombre de fichero cuando el JSON es válido pero no trae idODE/id", async () => {
		await writeFile(
			path.join(dir, "sin-id.json"),
			JSON.stringify({ titleStr: "Sin identificador" }),
		);
		await writeFile(path.join(dir, "sin-id.elpx"), "zip-bytes");

		const { pairs } = await findLegacySourcePairs(dir);
		const resolved = await collect(
			iterateResolvedPairs(pairs, resolveLegacyExternalId),
		);

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
				// Deliberadamente vacío: con blocking:true el flujo corta antes de
				// leer `resource`, y este test comprueba justamente eso.
				resource: {} as unknown as ReturnType<
					Deps["mapLegacyRecord"]
				>["resource"],
			})) as Deps["mapLegacyRecord"],
			processElpxUpload: (async () => {
				processCalled = true;
				throw new Error("no debería llamarse");
			}) as Deps["processElpxUpload"],
			repo: {
				backfillLegacyEducationalAreas: async () => [],
				findLegacyResourceByExternalId: async () => null,
				getElpxProjectByHash: async () => null,
				importLegacyResourceWithElpx: async () => {
					importCalled = true;
					throw new Error("no debería llamarse");
				},
			},
		});

		const report = await runImportLegacyProcomun(
			{ sourceDir: dir, dryRun: false },
			deps,
		);

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
				backfillLegacyEducationalAreas: async () => [],
				findLegacyResourceByExternalId: async () => ({
					id: "existing-id",
					slug: "existing",
				}),
				getElpxProjectByHash: async () => null,
				importLegacyResourceWithElpx: async () => {
					importCalled = true;
					throw new Error("no debería llamarse");
				},
			},
		});

		const report = await runImportLegacyProcomun(
			{ sourceDir: dir, dryRun: false },
			deps,
		);

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
				backfillLegacyEducationalAreas: async () => [],
				findLegacyResourceByExternalId: async () => null,
				getElpxProjectByHash: async () => null,
				importLegacyResourceWithElpx: async () => {
					importCalled = true;
					throw new Error("no debería llamarse en dry-run");
				},
			},
		});

		const report = await runImportLegacyProcomun(
			{ sourceDir: dir, dryRun: true },
			deps,
		);

		expect(report.dryRun).toBe(true);
		expect(report.totals.imported).toBe(1);
		expect(report.records[0]).toMatchObject({ outcome: "would_import" });
		expect(processCalled).toBe(false);
		expect(importCalled).toBe(false);
		expect(report.categorizacionEducativa).toEqual({
			recursosConTodasTransformadas: 0,
			recursosPendientesDeRevision: 0,
			recursosSinCategorizacionDeOrigen: 1,
			categoriasNoReconocidas: [],
		});
	});

	test("el informe cuenta la correspondencia por recurso y no bloquea lo no reconocido", async () => {
		const deps = buildMockDeps(storageDir, {
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
					levels: [
						"Formación Profesional",
						"Formación Profesional Básica (más de 15 años)",
						"Categoría sin regla",
					],
					author: null,
					publisher: null,
					keywords: null,
					importedAt: null,
				},
			})) as Deps["mapLegacyRecord"],
		});

		const report = await runImportLegacyProcomun(
			{ sourceDir: dir, dryRun: true },
			deps,
		);

		expect(report.totals.imported).toBe(1);
		expect(report.categorizacionEducativa).toEqual({
			recursosConTodasTransformadas: 0,
			recursosPendientesDeRevision: 1,
			recursosSinCategorizacionDeOrigen: 0,
			categoriasNoReconocidas: [
				{ categoria: "Categoría sin regla", recursos: ["es_mock"] },
			],
		});
	});

	test("un registro importable llama a processElpxUpload y persiste vía el repositorio", async () => {
		const deps = buildMockDeps(storageDir);
		const report = await runImportLegacyProcomun(
			{ sourceDir: dir, dryRun: false },
			deps,
		);

		expect(report.totals.imported).toBe(1);
		expect(report.records[0]).toMatchObject({
			outcome: "imported",
			resourceId: "mock-resource-id",
		});
	});

	test("un fallo al persistir se cuenta como error y no aborta el resto del lote", async () => {
		await writeFile(path.join(dir, "otro.json"), "{}");
		await writeFile(path.join(dir, "otro.elpx"), "fake-zip-bytes");

		let calls = 0;
		const deps = buildMockDeps(storageDir, {
			mapLegacyRecord: ((_json: unknown, fallbackTitle: string) => ({
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
				backfillLegacyEducationalAreas: async () => [],
				findLegacyResourceByExternalId: async () => null,
				importLegacyResourceWithElpx: async () => {
					calls++;
					if (calls === 1)
						throw new Error("fallo simulado en el primer registro");
					return {
						resourceId: "mock-resource-id-2",
						slug: "mock-slug-2",
						mediaItemId: "mock-media-id-2",
						elpxProjectId: "mock-elpx-id-2",
					};
				},
				getElpxProjectByHash: async () => null,
			},
		});

		const report = await runImportLegacyProcomun(
			{ sourceDir: dir, dryRun: false },
			deps,
		);

		expect(report.totals.processed).toBe(2);
		expect(report.totals.errored).toBe(1);
		expect(report.totals.imported).toBe(1);
	});

	test("dos ejecuciones concurrentes del mismo contenido: la restricción UNIQUE de BD decide, y la perdedora solo limpia su propio directorio (TOCTOU)", async () => {
		// Regresión del hallazgo P1 de la 3ª ronda de revisión del PR #268
		// (condición de carrera): la comprobación previa de getElpxProjectByHash()
		// no es atómica con la extracción ni la persistencia. Desde el hallazgo
		// P1 de la revisión del 2026-07-16 (recuperabilidad tras caída del
		// proceso), la inserción en BD ocurre ANTES de promocionar el directorio
		// de extracción a su ruta final por checksum: es la restricción UNIQUE de
		// `elpx_projects.hash`, no un rename atómico, la que decide quién gana —
		// ver promoteElpxExtractionPath(). Se simula la carrera con
		// getElpxProjectByHash() devolviendo siempre null (ambas ejecuciones "ven"
		// que el hash no existe todavía) y dos llamadas a runImportLegacyProcomun
		// lanzadas con Promise.all.
		await writeFile(path.join(dir, "dup-a.json"), "{}");
		await writeFile(path.join(dir, "dup-a.elpx"), "fake-zip-bytes-a");
		await writeFile(path.join(dir, "dup-b.json"), "{}");
		await writeFile(path.join(dir, "dup-b.elpx"), "fake-zip-bytes-b");

		const removedPaths: string[] = [];
		const extractPathsAtInsert: string[] = [];
		let insertCalls = 0;

		const deps = buildMockDeps(storageDir, {
			mapLegacyRecord: ((_json: unknown, fallbackTitle: string) => ({
				externalId: fallbackTitle.replace(".elpx", ""),
				blocking: false,
				blockingErrors: [],
				warnings: [],
				resource: {
					externalId: fallbackTitle.replace(".elpx", ""),
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
			// computeFileSha256 (heredado del base mock) devuelve siempre
			// "mock-checksum": ambos intentos apuntan al mismo checksum, forzando
			// la colisión en la restricción UNIQUE simulada abajo.
			removeElpxExtraction: (async (extractPath: string) => {
				removedPaths.push(extractPath);
				await rm(extractPath, { recursive: true, force: true });
			}) as Deps["removeElpxExtraction"],
			repo: {
				backfillLegacyEducationalAreas: async () => [],
				findLegacyResourceByExternalId: async () => null,
				// Ambas ejecuciones ven "no existe" — la carrera pasa el pre-check.
				getElpxProjectByHash: async () => null,
				importLegacyResourceWithElpx: async (
					_db: Parameters<Deps["repo"]["importLegacyResourceWithElpx"]>[0],
					input: Parameters<Deps["repo"]["importLegacyResourceWithElpx"]>[1],
				) => {
					insertCalls++;
					extractPathsAtInsert.push(input.elpx.extractPath);
					if (insertCalls === 1) {
						return {
							resourceId: "winner-id",
							slug: "winner",
							mediaItemId: "m1",
							elpxProjectId: "e1",
						};
					}
					throw new Error(
						'duplicate key value violates unique constraint "elpx_projects_hash_idx"',
					);
				},
			},
		});

		const [reportA, reportB] = await Promise.all([
			runImportLegacyProcomun(
				{ sourceDir: dir, dryRun: false, only: "dup-a" },
				deps,
			),
			runImportLegacyProcomun(
				{ sourceDir: dir, dryRun: false, only: "dup-b" },
				deps,
			),
		]);

		expect(reportA.totals.imported + reportB.totals.imported).toBe(1);
		expect(reportA.totals.errored + reportB.totals.errored).toBe(1);

		// Ambas ejecuciones llegan a llamar a importLegacyResourceWithElpx(); la
		// restricción UNIQUE (simulada) decide, no el orden de extracción.
		expect(insertCalls).toBe(2);
		expect(extractPathsAtInsert).toHaveLength(2);
		// Las dos apuntan a la misma ruta final por checksum (construida antes de
		// insertar, no tras un rename): exactamente la que hace que la URL
		// pública de preview resuelva bien.
		expect(extractPathsAtInsert[0]).toBe(extractPathsAtInsert[1]);
		expect(extractPathsAtInsert[0]).toBe(
			path.join(storageDir, "elpx", "mock-checksum"),
		);

		// La perdedora limpia únicamente su propio directorio privado por
		// uploadId (nunca visto por BD), nunca el directorio final que sí ganó y
		// promocionó la ganadora tras confirmar en BD.
		expect(removedPaths).toHaveLength(1);
		expect(removedPaths[0]).not.toBe(extractPathsAtInsert[0]);

		// El directorio final por checksum, promocionado por la ganadora tras su
		// commit, sigue intacto tras la carrera.
		const contentXmlExists = await Bun.file(
			path.join(extractPathsAtInsert[0] as string, "content.xml"),
		).exists();
		expect(contentXmlExists).toBe(true);
	});

	test("un directorio huérfano en storageDir/elpx/<checksum> sin fila en BD no bloquea la importación (regresión P1, revisión #268: recuperación tras caída del proceso)", async () => {
		// Antes del reordenamiento (rename antes que el commit en BD), un
		// proceso interrumpido justo después de ganar el rename pero antes de
		// confirmar en BD dejaba exactamente este estado: un directorio en la
		// ruta final por checksum, sin ninguna fila en elpx_projects que lo
		// referencie — y bloqueaba para siempre cualquier reimportación futura
		// del mismo contenido (el rename de un nuevo intento fallaría con
		// ENOTEMPTY contra ese huérfano). Con el commit en BD antes del rename,
		// la inserción es la única dueña legítima del checksum, así que
		// promoteElpxExtractionPath() puede reclamar (borrar) el huérfano.
		await mkdir(path.join(storageDir, "elpx", "mock-checksum"), {
			recursive: true,
		});
		await writeFile(
			path.join(storageDir, "elpx", "mock-checksum", "content.xml"),
			"contenido huérfano",
		);

		const deps = buildMockDeps(storageDir); // getElpxProjectByHash del mock base -> null

		const report = await runImportLegacyProcomun(
			{ sourceDir: dir, dryRun: false },
			deps,
		);

		expect(report.totals.imported).toBe(1);
		expect(report.totals.errored).toBe(0);
		expect(report.records[0]).toMatchObject({ outcome: "imported" });

		// El huérfano se reclamó: el directorio final contiene ahora el
		// contenido recién extraído, no el huérfano preexistente.
		const content = await Bun.file(
			path.join(storageDir, "elpx", "mock-checksum", "content.xml"),
		).text();
		expect(content).toBe("<ode/>");
	});

	test("un .json malformado se reporta como error sin abortar el resto del lote", async () => {
		await writeFile(path.join(dir, "es_mock.json"), "{ esto no es JSON válido");
		await writeFile(path.join(dir, "otro.json"), "{}");
		await writeFile(path.join(dir, "otro.elpx"), "fake-zip-bytes");

		const deps = buildMockDeps(storageDir);
		const report = await runImportLegacyProcomun(
			{ sourceDir: dir, dryRun: false },
			deps,
		);

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
		const report = await runImportLegacyProcomun(
			{ sourceDir: dir, dryRun: false, only: "es_mock" },
			deps,
		);

		expect(report.totals.pairsFound).toBe(2);
		expect(report.totals.processed).toBe(1);
	});

	test("--limit limita el número de pares procesados", async () => {
		await writeFile(path.join(dir, "otro.json"), "{}");
		await writeFile(path.join(dir, "otro.elpx"), "fake-zip-bytes");

		const deps = buildMockDeps(storageDir);
		const report = await runImportLegacyProcomun(
			{ sourceDir: dir, dryRun: false, limit: 1 },
			deps,
		);

		expect(report.totals.pairsFound).toBe(2);
		expect(report.totals.processed).toBe(1);
	});
});

describe("runBackfillLegacyEducationalAreas (deps mockeadas)", () => {
	test("pasa --dry-run al repositorio y resume con el informe de la importación", async () => {
		const dryRuns: boolean[] = [];
		const base = buildMockDeps("");
		const deps = buildMockDeps("", {
			repo: {
				...base.repo,
				backfillLegacyEducationalAreas: async (_db, options) => {
					dryRuns.push(options.dryRun);
					return [
						{ externalId: "es_1", sourceCategories: ["Bachillerato"] },
						{ externalId: "es_2", sourceCategories: ["Categoría sin regla"] },
						{ externalId: "es_3", sourceCategories: [] },
					];
				},
			},
		});

		const report = await runBackfillLegacyEducationalAreas(
			{ dryRun: true },
			deps,
		);

		expect(dryRuns).toEqual([true]);
		expect(report.dryRun).toBe(true);
		expect(report.totals).toEqual({ processed: 3 });
		expect(report.categorizacionEducativa).toEqual({
			recursosConTodasTransformadas: 1,
			recursosPendientesDeRevision: 1,
			recursosSinCategorizacionDeOrigen: 1,
			categoriasNoReconocidas: [
				{ categoria: "Categoría sin regla", recursos: ["es_2"] },
			],
		});
	});
});
