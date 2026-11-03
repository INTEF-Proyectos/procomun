import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LegacyOdeJson } from "@procomun/db/legacy-import";
import {
	mapLegacyRecord,
	resolveLegacyExternalId,
	resolveLegacyPublicationStatus,
} from "@procomun/db/legacy-import";
import { extractTextFromHtml } from "../../../api/src/fts/extract.ts";
import { isAllowedPreviewImageUrl } from "../../../api/src/services/legacy-preview-image.ts";
import {
	findLegacyJsonFiles,
	findLegacySourcePairs,
	iterateResolvedPairs,
	type loadImportLegacyProcomunDependencies,
	runBackfillLegacyEducationalAreas,
	runCopyLegacyPreviews,
	runImportLegacyProcomun,
	runLinkLegacyAuthors,
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
		// Implementación real: es pura (texto del cuerpo de los artículos, #446).
		extractTextFromHtml,
		copyLegacyPreviewImage: (async () => ({
			ok: false,
			reason: "sin red en los tests",
			retryable: false,
		})) as Deps["copyLegacyPreviewImage"],
		// Implementación real: es pura y decide el dry-run de --copy-previews.
		isAllowedPreviewImageUrl,
		listLegacyRemoteThumbnails:
			(async () => []) as Deps["listLegacyRemoteThumbnails"],
		setResourceThumbnailUrl:
			(async () => {}) as Deps["setResourceThumbnailUrl"],
		// Implementación real (no mockeada): es pura y los fixtures de estos
		// tests son JSON vacíos "{}", así que resuelve "" y cada par cae al
		// fallback por baseName, preservando la identidad distinta de cada par
		// que esperan los tests existentes.
		resolveLegacyExternalId,
		resolveLegacyPublicationStatus,
		mapLegacyRecord: (() => ({
			externalId: "es_mock",
			kind: "ode",
			blocking: false,
			blockingErrors: [],
			warnings: [],
			publicatorEmail: null,
			articleHtml: null,
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
				previewImageUrl: null,
				editorialStatus: "published",
				sourcePublished: 1,
			},
		})) as Deps["mapLegacyRecord"],
		// #456: por defecto ninguna cuenta coincide con publicatorEmailStr.
		findLegacyAuthorAccount: async () => null,
		linkLegacyResourceAuthor: async () => ({ outcome: "not_found" }),
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
			unpublishUnreviewedLegacyResource: async () => ({
				outcome: "not_found",
				resourceId: null,
			}),
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
				publicatorEmail: null,
				kind: "ode",
				articleHtml: null,
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
				unpublishUnreviewedLegacyResource: async () => ({
					outcome: "not_found",
					resourceId: null,
				}),
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
				unpublishUnreviewedLegacyResource: async () => ({
					outcome: "not_found",
					resourceId: null,
				}),
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
				unpublishUnreviewedLegacyResource: async () => ({
					outcome: "not_found",
					resourceId: null,
				}),
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
			eleEnOtroIdioma: [],
		});
	});

	test("el informe cuenta la correspondencia por recurso y no bloquea lo no reconocido", async () => {
		const deps = buildMockDeps(storageDir, {
			mapLegacyRecord: (() => ({
				externalId: "es_mock",
				blocking: false,
				blockingErrors: [],
				warnings: [],
				publicatorEmail: null,
				kind: "ode",
				articleHtml: null,
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
					previewImageUrl: null,
					importedAt: null,
					editorialStatus: "published",
					sourcePublished: 1,
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
			eleEnOtroIdioma: [],
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

	// #409: la imagen preview legacy se copia y no se enlaza en caliente.
	describe("imagen preview legacy", () => {
		const REMOTE =
			"https://ode.educacion.es/INTEF/1416349635379/vistaPreviaAgrega.png";

		function depsWithPreview(
			copy: Deps["copyLegacyPreviewImage"],
			onImport: (previewImageUrl: string | null) => void,
		) {
			const base = buildMockDeps(storageDir);
			return buildMockDeps(storageDir, {
				mapLegacyRecord: ((...args: Parameters<Deps["mapLegacyRecord"]>) => {
					const mapping = base.mapLegacyRecord(...args);
					return {
						...mapping,
						resource: { ...mapping.resource, previewImageUrl: REMOTE },
					};
				}) as Deps["mapLegacyRecord"],
				copyLegacyPreviewImage: copy,
				repo: {
					...base.repo,
					importLegacyResourceWithElpx: async (
						_db: Parameters<Deps["repo"]["importLegacyResourceWithElpx"]>[0],
						input: Parameters<Deps["repo"]["importLegacyResourceWithElpx"]>[1],
					) => {
						onImport(input.resource.previewImageUrl);
						return {
							resourceId: "mock-resource-id",
							slug: "mock-slug",
							mediaItemId: "mock-media-id",
							elpxProjectId: "mock-elpx-id",
						};
					},
				},
			});
		}

		test("guarda la copia local de la imagen", async () => {
			let saved: string | null | undefined;
			let copiedFrom: string | undefined;
			const deps = depsWithPreview(
				(async (url: string) => {
					copiedFrom = url;
					return { ok: true, url: `/api/v1/thumbnails/${"a".repeat(64)}.png` };
				}) as Deps["copyLegacyPreviewImage"],
				(url) => {
					saved = url;
				},
			);

			await runImportLegacyProcomun({ sourceDir: dir, dryRun: false }, deps);

			expect(copiedFrom).toBe(REMOTE);
			expect(saved).toBe(`/api/v1/thumbnails/${"a".repeat(64)}.png`);
		});

		test("si no se puede copiar, no enlaza la remota y lo avisa", async () => {
			let saved: string | null | undefined = "sin llamar";
			const deps = depsWithPreview(
				(async () => ({
					ok: false,
					reason: "HTTP 404",
					retryable: false,
				})) as Deps["copyLegacyPreviewImage"],
				(url) => {
					saved = url;
				},
			);

			const report = await runImportLegacyProcomun(
				{ sourceDir: dir, dryRun: false },
				deps,
			);

			expect(saved).toBeNull();
			expect(report.records[0]).toMatchObject({ outcome: "imported" });
			const record = report.records[0] as { warnings?: string[] };
			expect(record.warnings).toContain(
				`preview: no se copia la imagen ${REMOTE} (HTTP 404)`,
			);
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
				publicatorEmail: null,
				kind: "ode",
				articleHtml: null,
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
					previewImageUrl: null,
					editorialStatus: "published",
					sourcePublished: 1,
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
				unpublishUnreviewedLegacyResource: async () => ({
					outcome: "not_found",
					resourceId: null,
				}),
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
				publicatorEmail: null,
				kind: "ode",
				articleHtml: null,
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
					previewImageUrl: null,
					editorialStatus: "published",
					sourcePublished: 1,
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
				unpublishUnreviewedLegacyResource: async () => ({
					outcome: "not_found",
					resourceId: null,
				}),
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
			eleEnOtroIdioma: [],
		});
	});
});

// #409: --copy-previews copia las miniaturas legacy ya importadas.
describe("runCopyLegacyPreviews", () => {
	const ODE = "https://ode.educacion.es/INTEF";
	const ROWS = [
		{ id: "r-ok", externalId: "es_ok", thumbnailUrl: `${ODE}/ok/a.png` },
		{ id: "r-404", externalId: "es_404", thumbnailUrl: `${ODE}/404/a.png` },
		{ id: "r-red", externalId: "es_red", thumbnailUrl: `${ODE}/red/a.png` },
		{
			id: "r-otro",
			externalId: "es_otro",
			thumbnailUrl: "https://otro.example/a.png",
		},
	];
	const LOCAL = `/api/v1/thumbnails/${"c".repeat(64)}.png`;

	function deps() {
		const updates: Array<[string, string | null]> = [];
		const copied: string[] = [];
		const base = buildMockDeps("/tmp/no-se-usa");
		return {
			updates,
			copied,
			deps: {
				...base,
				listLegacyRemoteThumbnails: (async () =>
					ROWS) as Deps["listLegacyRemoteThumbnails"],
				setResourceThumbnailUrl: (async (
					_db: unknown,
					id: string,
					url: string | null,
				) => {
					updates.push([id, url]);
				}) as Deps["setResourceThumbnailUrl"],
				copyLegacyPreviewImage: (async (url: string) => {
					copied.push(url);
					if (url.includes("/ok/")) return { ok: true, url: LOCAL };
					if (url.includes("/404/"))
						return { ok: false, reason: "HTTP 404", retryable: false };
					if (url.includes("/red/"))
						return {
							ok: false,
							reason: "error de red (ECONNRESET)",
							retryable: true,
						};
					return { ok: false, reason: "host no permitido", retryable: false };
				}) as Deps["copyLegacyPreviewImage"],
			} as Deps,
		};
	}

	test("copia, retira lo que no se puede copiar y deja lo reintentable", async () => {
		const { deps: d, updates } = deps();

		const report = await runCopyLegacyPreviews({ dryRun: false }, d);

		expect(updates).toEqual([
			["r-ok", LOCAL],
			["r-404", null],
			["r-otro", null],
		]);
		expect(report.totals).toEqual({
			processed: 4,
			copied: 1,
			removed: 2,
			retryable: 1,
		});
		expect(report.records).toContainEqual({
			externalId: "es_red",
			resourceId: "r-red",
			sourceUrl: `${ODE}/red/a.png`,
			outcome: "retryable",
			reason: "error de red (ECONNRESET)",
		});
	});

	test("--dry-run no descarga ni escribe; clasifica por host", async () => {
		const { deps: d, updates, copied } = deps();

		const report = await runCopyLegacyPreviews({ dryRun: true }, d);

		expect(updates).toEqual([]);
		expect(copied).toEqual([]);
		expect(report.totals).toEqual({
			processed: 4,
			copied: 3,
			removed: 1,
			retryable: 0,
		});
		expect(report.records.map((r) => r.outcome)).toEqual([
			"would_copy",
			"would_copy",
			"would_copy",
			"would_remove",
		]);
	});
});

// #456: cada recurso pasa a la cuenta cuyo correo es su publicatorEmailStr.
describe("runImportLegacyProcomun — autoría (issue #456)", () => {
	let dir: string;
	let storageDir: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "legacy-author-"));
		storageDir = await mkdtemp(path.join(tmpdir(), "legacy-author-storage-"));
		await writeFile(path.join(dir, "es_mock.json"), "{}");
		await writeFile(path.join(dir, "es_mock.elpx"), "fake-zip-bytes");
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
		await rm(storageDir, { recursive: true, force: true });
	});

	/** Mapeo del mock base con el correo dado y el externalId del fichero. */
	function mapWithEmail(email: string | null) {
		const base = buildMockDeps(storageDir);
		return ((json: LegacyOdeJson, fallback: string) => {
			const mapping = base.mapLegacyRecord(json, fallback);
			const externalId = fallback.replace(/\.elpx$/, "");
			return {
				...mapping,
				externalId,
				publicatorEmail: email,
				resource: { ...mapping.resource, externalId },
			};
		}) as Deps["mapLegacyRecord"];
	}

	function captureImports() {
		const calls: Parameters<Deps["repo"]["importLegacyResourceWithElpx"]>[1][] =
			[];
		const base = buildMockDeps(storageDir).repo;
		return {
			calls,
			repo: {
				...base,
				importLegacyResourceWithElpx: (async (_db, input) => {
					calls.push(input);
					return base.importLegacyResourceWithElpx(_db, input);
				}) as Deps["repo"]["importLegacyResourceWithElpx"],
			},
		};
	}

	test("un recurso nuevo pasa a la cuenta con ese correo", async () => {
		const lookups: string[] = [];
		const { calls, repo } = captureImports();
		const deps = buildMockDeps(storageDir, {
			mapLegacyRecord: mapWithEmail("autora@ejemplo.test"),
			findLegacyAuthorAccount: async (_db, email) => {
				lookups.push(email);
				return { id: "autora-1", deleted: false };
			},
			repo,
		});

		const report = await runImportLegacyProcomun(
			{ sourceDir: dir, dryRun: false },
			deps,
		);

		expect(lookups).toEqual(["autora@ejemplo.test"]);
		expect(calls[0]?.resource.createdBy).toBe("autora-1");
		// El paquete lo subió el importador: la sesión de subida no cambia.
		expect(calls[0]?.media.ownerId).toBe("system-user");
		expect(report.records[0]).toMatchObject({
			outcome: "imported",
			createdBy: "autora-1",
		});
		expect(report.totals.authorLinked).toBe(1);
		expect(report.totals.authorWithoutAccount).toBe(0);
		expect(report.authorsWithoutAccount).toEqual([]);
	});

	test("sin cuenta queda a nombre del sistema, sale en el informe y no falla el lote", async () => {
		const { calls, repo } = captureImports();
		const deps = buildMockDeps(storageDir, {
			mapLegacyRecord: mapWithEmail("nadie@ejemplo.test"),
			repo,
		});

		const report = await runImportLegacyProcomun(
			{ sourceDir: dir, dryRun: false },
			deps,
		);

		expect(calls[0]?.resource.createdBy).toBeNull();
		expect(report.totals.imported).toBe(1);
		expect(report.totals.errored).toBe(0);
		expect(report.records[0]).toMatchObject({
			outcome: "imported",
			createdBy: null,
		});
		expect(report.totals.authorWithoutAccount).toBe(1);
		expect(report.authorsWithoutAccount).toEqual([
			{
				externalId: "es_mock",
				email: "nadie@ejemplo.test",
				reason: "no_account",
			},
		]);
	});

	test("una cuenta dada de baja no recibe el recurso; sin correo tampoco se busca", async () => {
		await writeFile(path.join(dir, "es_sin_correo.json"), "{}");
		await writeFile(path.join(dir, "es_sin_correo.elpx"), "otros-bytes");
		const lookups: string[] = [];
		const base = buildMockDeps(storageDir);
		const deps = buildMockDeps(storageDir, {
			mapLegacyRecord: ((json: LegacyOdeJson, fallback: string) =>
				fallback === "es_mock.elpx"
					? mapWithEmail("baja@ejemplo.test")(json, fallback)
					: {
							...mapWithEmail(null)(json, fallback),
							externalId: "es_sin_correo",
						}) as Deps["mapLegacyRecord"],
			findLegacyAuthorAccount: async (_db, email) => {
				lookups.push(email);
				return { id: "autora-baja", deleted: true };
			},
			repo: { ...base.repo },
		});

		const report = await runImportLegacyProcomun(
			{ sourceDir: dir, dryRun: true },
			deps,
		);

		expect(lookups).toEqual(["baja@ejemplo.test"]);
		expect(report.authorsWithoutAccount).toEqual([
			{
				externalId: "es_mock",
				email: "baja@ejemplo.test",
				reason: "deleted_account",
			},
			{ externalId: "es_sin_correo", email: null, reason: "no_email" },
		]);
	});

	test("la misma cuenta se busca una sola vez por ejecución", async () => {
		await writeFile(path.join(dir, "es_otro.json"), "{}");
		await writeFile(path.join(dir, "es_otro.elpx"), "otros-bytes");
		let lookups = 0;
		const deps = buildMockDeps(storageDir, {
			mapLegacyRecord: mapWithEmail("autora@ejemplo.test"),
			findLegacyAuthorAccount: async () => {
				lookups++;
				return { id: "autora-1", deleted: false };
			},
		});

		const report = await runImportLegacyProcomun(
			{ sourceDir: dir, dryRun: true },
			deps,
		);

		expect(report.totals.authorLinked).toBe(2);
		expect(lookups).toBe(1);
	});

	test("--dry-run dice a quién pasaría sin escribir nada", async () => {
		const { calls, repo } = captureImports();
		const deps = buildMockDeps(storageDir, {
			mapLegacyRecord: mapWithEmail("autora@ejemplo.test"),
			findLegacyAuthorAccount: async () => ({ id: "autora-1", deleted: false }),
			repo,
		});

		const report = await runImportLegacyProcomun(
			{ sourceDir: dir, dryRun: true },
			deps,
		);

		expect(calls).toEqual([]);
		expect(report.records[0]).toMatchObject({
			outcome: "would_import",
			createdBy: "autora-1",
		});
		expect(report.totals.authorLinked).toBe(1);
	});

	describe("al reimportar lo ya importado", () => {
		function depsForExisting(
			result: Awaited<ReturnType<Deps["linkLegacyResourceAuthor"]>>,
			links: Array<[string, string, boolean]>,
		) {
			const base = buildMockDeps(storageDir);
			return buildMockDeps(storageDir, {
				mapLegacyRecord: mapWithEmail("autora@ejemplo.test"),
				findLegacyAuthorAccount: async () => ({
					id: "autora-1",
					deleted: false,
				}),
				linkLegacyResourceAuthor: async (_db, resourceId, userId, opts) => {
					links.push([resourceId, userId, opts.dryRun]);
					return result;
				},
				repo: {
					...base.repo,
					findLegacyResourceByExternalId: async () => ({
						id: "existing-id",
						slug: "existing",
					}),
				},
			});
		}

		test("enlaza el recurso con la cuenta que ahora existe", async () => {
			const links: Array<[string, string, boolean]> = [];
			const report = await runImportLegacyProcomun(
				{ sourceDir: dir, dryRun: false },
				depsForExisting({ outcome: "linked" }, links),
			);

			expect(links).toEqual([["existing-id", "autora-1", false]]);
			expect(report.totals.skippedExisting).toBe(1);
			expect(report.totals.authorLinked).toBe(1);
			expect(report.records[0]).toEqual({
				outcome: "skipped_existing",
				externalId: "es_mock",
				authorLink: "linked",
			});
		});

		test("en seco lo cuenta sin escribir", async () => {
			const links: Array<[string, string, boolean]> = [];
			const report = await runImportLegacyProcomun(
				{ sourceDir: dir, dryRun: true },
				depsForExisting({ outcome: "linked" }, links),
			);

			expect(links).toEqual([["existing-id", "autora-1", true]]);
			expect(report.totals.authorLinked).toBe(1);
			expect(report.records[0]).toMatchObject({ authorLink: "would_link" });
		});

		test("no pisa a un creador real ni cuenta lo ya enlazado", async () => {
			for (const result of [
				{ outcome: "kept_creator", createdBy: "editora" },
				{ outcome: "already_linked" },
			] as const) {
				const report = await runImportLegacyProcomun(
					{ sourceDir: dir, dryRun: false },
					depsForExisting(result, []),
				);
				expect(report.totals.authorLinked).toBe(0);
				expect(report.records[0]).toMatchObject({
					authorLink: result.outcome,
				});
			}
		});

		test("sin cuenta no intenta enlazar y lo lista", async () => {
			const links: Array<[string, string, boolean]> = [];
			const base = buildMockDeps(storageDir);
			const report = await runImportLegacyProcomun(
				{ sourceDir: dir, dryRun: false },
				{
					...depsForExisting({ outcome: "linked" }, links),
					findLegacyAuthorAccount: base.findLegacyAuthorAccount,
				},
			);

			expect(links).toEqual([]);
			expect(report.records[0]).toMatchObject({
				authorLink: "without_account",
			});
			expect(report.authorsWithoutAccount).toHaveLength(1);
		});
	});
});

// #446: los artículos (`type: "POST"`) se importan con el mapeo real y solo
// si su publicatorEmailStr lleva a una cuenta; si no, se listan en el informe.
describe("runImportLegacyProcomun — artículos (issue #446)", () => {
	const ARTICLE_FIXTURES = path.join(
		import.meta.dir,
		"../../../../packages/db/src/test-fixtures/legacy-procomun",
	);
	const PUBLISHED = "1400000000001";
	const DRAFT = "ArtBorrador000000001";
	let dir: string;
	let storageDir: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "legacy-articles-"));
		storageDir = await mkdtemp(path.join(tmpdir(), "legacy-articles-storage-"));
		for (const id of [PUBLISHED, DRAFT]) {
			await copyFile(
				path.join(ARTICLE_FIXTURES, `${id}.json`),
				path.join(dir, `${id}.json`),
			);
			await writeFile(path.join(dir, `${id}.elpx`), `fake-zip-${id}`);
		}
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
		await rm(storageDir, { recursive: true, force: true });
	});

	/** Deps con el mapeo y la conversión a texto reales, que registran lo que se persiste. */
	function articleDeps(
		accounts: Record<string, { id: string; deleted: boolean }>,
		overrides: Partial<Deps> = {},
	) {
		const calls: Parameters<Deps["repo"]["importLegacyResourceWithElpx"]>[1][] =
			[];
		let extractions = 0;
		const base = buildMockDeps(storageDir);
		const deps = buildMockDeps(storageDir, {
			mapLegacyRecord,
			findLegacyAuthorAccount: async (_db, email) => accounts[email] ?? null,
			processElpxUpload: (async (...args) => {
				extractions++;
				return base.processElpxUpload(...args);
			}) as Deps["processElpxUpload"],
			repo: {
				...base.repo,
				importLegacyResourceWithElpx: (async (_db, input) => {
					calls.push(input);
					return {
						...(await base.repo.importLegacyResourceWithElpx(_db, input)),
						resourceId: `resource-${input.resource.externalId}`,
					};
				}) as Deps["repo"]["importLegacyResourceWithElpx"],
			},
			...overrides,
		});
		return { deps, calls, extractions: () => extractions };
	}

	test("sin cuenta de autor no se importa: el informe lo lista con el correo y el motivo", async () => {
		const { deps, calls, extractions } = articleDeps({});

		const report = await runImportLegacyProcomun(
			{ sourceDir: dir, dryRun: false },
			deps,
		);

		expect(calls).toEqual([]);
		expect(extractions()).toBe(0);
		expect(report.totals).toMatchObject({
			processed: 2,
			articles: 2,
			imported: 0,
			skippedWithoutAuthor: 2,
			blocked: 0,
			errored: 0,
		});
		expect(report.records).toEqual([
			{
				outcome: "skipped_without_author",
				externalId: PUBLISHED,
				kind: "article",
				email: "articulista.uno@ejemplo.test",
				reason: "no_account",
			},
			{
				outcome: "skipped_without_author",
				externalId: DRAFT,
				kind: "article",
				email: "articulista.dos@ejemplo.test",
				reason: "no_account",
			},
		]);
		// No se importan, así que no quedan a nombre del sistema.
		expect(report.authorsWithoutAccount).toEqual([]);
	});

	test("una cuenta dada de baja o un artículo sin correo tampoco se importan", async () => {
		await writeFile(
			path.join(dir, `${DRAFT}.json`),
			JSON.stringify({
				...(await Bun.file(
					path.join(ARTICLE_FIXTURES, `${DRAFT}.json`),
				).json()),
				publicatorEmailStr: "",
			}),
		);
		const { deps, calls } = articleDeps({
			"articulista.uno@ejemplo.test": { id: "baja", deleted: true },
		});

		const report = await runImportLegacyProcomun(
			{ sourceDir: dir, dryRun: false },
			deps,
		);

		expect(calls).toEqual([]);
		expect(
			report.records.map((r) => [
				r.externalId,
				"reason" in r ? r.reason : null,
				"email" in r ? r.email : undefined,
			]),
		).toEqual([
			[PUBLISHED, "deleted_account", "articulista.uno@ejemplo.test"],
			[DRAFT, "no_email", null],
		]);
	});

	test("--dry-run aplica la misma regla: sin cuenta no figura como importable", async () => {
		const { deps, calls } = articleDeps({
			"articulista.uno@ejemplo.test": { id: "autora-1", deleted: false },
		});

		const report = await runImportLegacyProcomun(
			{ sourceDir: dir, dryRun: true },
			deps,
		);

		expect(calls).toEqual([]);
		expect(report.records).toEqual([
			{
				outcome: "would_import",
				externalId: PUBLISHED,
				kind: "article",
				warnings: [
					'license: El artículo no trae licencia; se asigna la de por defecto de la plataforma ("cc-by")',
					"preview: preview no es una URL válida y no se importa",
				],
				editorialStatus: "published",
				sourcePublished: 1,
				createdBy: "autora-1",
			},
			{
				outcome: "skipped_without_author",
				externalId: DRAFT,
				kind: "article",
				email: "articulista.dos@ejemplo.test",
				reason: "no_account",
			},
		]);
		expect(report.totals).toMatchObject({
			imported: 1,
			skippedWithoutAuthor: 1,
			authorLinked: 1,
		});
	});

	test("con cuenta se importa a su nombre como «Artículo», con la licencia por defecto y su texto para la búsqueda", async () => {
		const { deps, calls } = articleDeps({
			"articulista.uno@ejemplo.test": { id: "autora-1", deleted: false },
			"articulista.dos@ejemplo.test": { id: "autora-2", deleted: false },
		});

		const report = await runImportLegacyProcomun(
			{ sourceDir: dir, dryRun: false },
			deps,
		);

		expect(report.totals).toMatchObject({
			articles: 2,
			imported: 2,
			importedAsDraft: 1,
			skippedWithoutAuthor: 0,
			authorLinked: 2,
			errored: 0,
		});
		const published = calls.find(
			(c) => c.resource.externalId === PUBLISHED,
		)?.resource;
		expect(published).toMatchObject({
			createdBy: "autora-1",
			resourceType: "articulo",
			license: "cc-by",
			description: "Artículo relacionado con Aula invertida",
			author: "Docente Articulista",
			editorialStatus: "published",
		});
		// El cuerpo HTML pasa a texto plano como cualquier HTML subido: sin
		// etiquetas, sin el <script> y con las entidades resueltas.
		expect(published?.extractedText).toBe(
			"Descripción del aula invertida para quien empieza.",
		);
		// El borrador es de su autora, sin publicar.
		expect(
			calls.find((c) => c.resource.externalId === DRAFT)?.resource,
		).toMatchObject({ createdBy: "autora-2", editorialStatus: "draft" });
		expect(report.records).toContainEqual(
			expect.objectContaining({
				outcome: "imported",
				externalId: DRAFT,
				kind: "article",
				editorialStatus: "draft",
				createdBy: "autora-2",
			}),
		);
		// El paquete lo sube el importador, igual que en los ODE (#456).
		expect(calls.every((c) => c.media.ownerId === "system-user")).toBe(true);
	});

	test("un artículo ya importado se omite y se enlaza si sigue a nombre del sistema", async () => {
		const links: string[] = [];
		const base = buildMockDeps(storageDir);
		const { deps, calls } = articleDeps(
			{ "articulista.uno@ejemplo.test": { id: "autora-1", deleted: false } },
			{
				linkLegacyResourceAuthor: async (_db, resourceId, userId) => {
					links.push(`${resourceId}->${userId}`);
					return { outcome: "linked" };
				},
				repo: {
					...base.repo,
					findLegacyResourceByExternalId: async (_db, _source, externalId) =>
						externalId === PUBLISHED
							? { id: "existing-article", slug: "existente" }
							: null,
				},
			},
		);

		const report = await runImportLegacyProcomun(
			{ sourceDir: dir, dryRun: false, only: PUBLISHED },
			deps,
		);

		expect(calls).toEqual([]);
		expect(links).toEqual(["existing-article->autora-1"]);
		expect(report.records).toEqual([
			{
				outcome: "skipped_existing",
				externalId: PUBLISHED,
				kind: "article",
				authorLink: "linked",
			},
		]);
	});
});

describe("findLegacyJsonFiles", () => {
	test("lista los .json tengan o no su .elpx", async () => {
		const dir = await mkdtemp(path.join(tmpdir(), "legacy-json-"));
		try {
			await writeFile(path.join(dir, "b.json"), "{}");
			await writeFile(path.join(dir, "a.json"), "{}");
			await writeFile(path.join(dir, "a.elpx"), "zip");
			await writeFile(path.join(dir, "c.elpx"), "zip");

			expect(await findLegacyJsonFiles(dir)).toEqual([
				{ baseName: "a", jsonPath: path.join(dir, "a.json") },
				{ baseName: "b", jsonPath: path.join(dir, "b.json") },
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

// #456: --link-authors enlaza lo ya importado leyendo solo los .json.
describe("runLinkLegacyAuthors", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(path.join(tmpdir(), "legacy-link-"));
		// Sin .elpx: no hace falta volver a descargar los paquetes.
		for (const [id, email] of [
			["es_enlazar", "Autora@Ejemplo.test"],
			["es_ya", "autora@ejemplo.test"],
			["es_reasignado", "autora@ejemplo.test"],
			["es_sin_cuenta", "nadie@ejemplo.test"],
			["es_no_importado", "autora@ejemplo.test"],
		] as const) {
			await writeFile(
				path.join(dir, `${id}.json`),
				JSON.stringify({ idODE: id, publicatorEmailStr: email }),
			);
		}
		await writeFile(path.join(dir, "roto.json"), "{no es json");
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	function deps(links: Array<[string, string, boolean]>) {
		const base = buildMockDeps("/tmp/no-se-usa");
		return buildMockDeps("/tmp/no-se-usa", {
			findLegacyAuthorAccount: async (_db, email) =>
				email === "autora@ejemplo.test"
					? { id: "autora-1", deleted: false }
					: null,
			linkLegacyResourceAuthor: async (_db, resourceId, userId, opts) => {
				links.push([resourceId, userId, opts.dryRun]);
				if (resourceId === "r-es_ya") return { outcome: "already_linked" };
				if (resourceId === "r-es_reasignado")
					return { outcome: "kept_creator", createdBy: "editora" };
				return { outcome: "linked" };
			},
			repo: {
				...base.repo,
				findLegacyResourceByExternalId: async (_db, _source, externalId) =>
					externalId === "es_no_importado"
						? null
						: { id: `r-${externalId}`, slug: externalId },
			},
		});
	}

	test("enlaza lo que sigue a nombre del sistema, respeta al creador real y lista lo que no tiene cuenta", async () => {
		const links: Array<[string, string, boolean]> = [];

		const report = await runLinkLegacyAuthors(
			{ sourceDir: dir, dryRun: false },
			deps(links),
		);

		expect(links).toEqual([
			["r-es_enlazar", "autora-1", false],
			["r-es_reasignado", "autora-1", false],
			["r-es_ya", "autora-1", false],
		]);
		expect(report.totals).toEqual({
			processed: 6,
			linked: 1,
			alreadyLinked: 1,
			keptCreator: 1,
			withoutAccount: 1,
			notImported: 1,
			errored: 1,
		});
		expect(report.records).toContainEqual({
			externalId: "es_enlazar",
			outcome: "linked",
			resourceId: "r-es_enlazar",
			userId: "autora-1",
		});
		expect(report.records).toContainEqual({
			externalId: "es_reasignado",
			outcome: "kept_creator",
			resourceId: "r-es_reasignado",
			userId: "autora-1",
			createdBy: "editora",
		});
		expect(report.records).toContainEqual({
			externalId: "es_no_importado",
			outcome: "not_imported",
		});
		expect(report.records.find((r) => r.externalId === "roto")?.outcome).toBe(
			"error",
		);
		expect(report.records.map((r) => r.externalId)).not.toContain("es_ya");
		expect(report.authorsWithoutAccount).toEqual([
			{
				externalId: "es_sin_cuenta",
				email: "nadie@ejemplo.test",
				reason: "no_account",
			},
		]);
	});

	test("--dry-run pasa el modo al repositorio y marca would_link", async () => {
		const links: Array<[string, string, boolean]> = [];

		const report = await runLinkLegacyAuthors(
			{ sourceDir: dir, dryRun: true },
			deps(links),
		);

		expect(links.every(([, , dryRun]) => dryRun)).toBe(true);
		expect(report.dryRun).toBe(true);
		expect(report.totals.linked).toBe(1);
		expect(report.records).toContainEqual({
			externalId: "es_enlazar",
			outcome: "would_link",
			resourceId: "r-es_enlazar",
			userId: "autora-1",
		});
	});
});
