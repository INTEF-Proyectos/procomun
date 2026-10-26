import { beforeAll, describe, expect, test } from "bun:test";
import { copyFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	getElpxProjectByResourceId,
	listMediaItemsForResource,
	listResources,
} from "@procomun/db/repository";
import { resourceEducationalAreas, resources } from "@procomun/db/schema";
import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { elpxContentRoutes } from "../../../api/src/routes/elpx-content.ts";
import { computeFileSha256 } from "../../../api/src/uploads/config.ts";
import {
	loadImportLegacyProcomunDependencies,
	runBackfillLegacyEducationalAreas,
	runFixLegacyLanguage,
	runFixLegacyPublished,
	runImportLegacyProcomun,
} from "./import-legacy-procomun.ts";

// Fixtures versionadas (anonimizadas, ver ADR-0029): 3 pares .json+.elpx reales
// de ode-export/, uno de ellos (es_2025101012_9102834) con una combinación de
// licencia CC inexistente ("non derived" + "share alike"), a propósito, para
// probar de extremo a extremo la resolución ND+SA -> *-sa de normalizeLicense()
// (ND y SA son mutuamente excluyentes en las licencias CC reales; se prioriza
// SA sobre ND en vez de bloquear el registro — decisión de negocio confirmada
// tras la revisión del PR #268, ver ADR-0029).
const FIXTURES_DIR = path.join(
	import.meta.dir,
	"../test-fixtures/legacy-procomun",
);

const MINIMAL_CONTENT_XML_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<ode xmlns="http://www.intef.es/xsd/ode" version="2.0">
  <odeProperties>
    <odeProperty>
      <key>pp_title</key>
      <value>Recurso de prueba __MARKER__</value>
    </odeProperty>
    <odeProperty>
      <key>pp_lang</key>
      <value>es</value>
    </odeProperty>
    <odeProperty>
      <key>pp_license</key>
      <value>creative commons: attribution</value>
    </odeProperty>
  </odeProperties>
</ode>`;

/** Construye un .elpx (ZIP) mínimo pero válido, con contenido distinto según
 * `marker` — necesario porque toda la suite comparte una única BD PGlite: dos
 * llamadas con `marker` distinto producen checksums distintos, garantizando
 * que un describe no colisione por accidente con contenido ya persistido por
 * otro (ver elpx_projects.hash UNIQUE). Dos llamadas con el MISMO `marker`
 * producen bytes idénticos a propósito, para los tests que necesitan
 * contenido duplicado real (dedup, carrera). */
async function createMinimalElpx(
	destPath: string,
	marker: string,
): Promise<void> {
	const staging = await mkdtemp(path.join(tmpdir(), "elpx-staging-"));
	const contentXml = MINIMAL_CONTENT_XML_TEMPLATE.replace("__MARKER__", marker);
	await writeFile(path.join(staging, "content.xml"), contentXml, "utf-8");
	const proc = Bun.spawn(
		["python3", "-m", "zipfile", "-c", destPath, "content.xml"],
		{
			cwd: staging,
			stdout: "ignore",
			stderr: "ignore",
		},
	);
	const exitCode = await proc.exited;
	if (exitCode !== 0)
		throw new Error(`No se pudo crear el .elpx sintético (exit ${exitCode})`);
}

describe("import:legacy-procomun (integración, PGlite en memoria vía test-setup.ts)", () => {
	let deps: Awaited<ReturnType<typeof loadImportLegacyProcomunDependencies>>;

	beforeAll(async () => {
		process.env.UPLOAD_STORAGE_DIR = await mkdtemp(
			path.join(tmpdir(), "legacy-import-storage-"),
		);
		deps = await loadImportLegacyProcomunDependencies();
	});

	test("--dry-run no persiste nada en base de datos", async () => {
		const report = await runImportLegacyProcomun(
			{ sourceDir: FIXTURES_DIR, dryRun: true },
			deps,
		);

		expect(report.totals.pairsFound).toBe(3);
		expect(report.totals.blocked).toBe(0);
		expect(report.totals.imported).toBe(3); // would_import
		expect(
			report.records.filter((r) => r.outcome === "would_import"),
		).toHaveLength(3);

		const stillMissing = await deps.repo.findLegacyResourceByExternalId(
			deps.getDb().db,
			"legacy-procomun",
			"es_2024052212_9181312",
		);
		expect(stillMissing).toBeNull();
	});

	test("una ejecución real importa los 3 pares, resolviendo la licencia ND+SA inexistente a cc-by-nc-sa con warning", async () => {
		const report = await runImportLegacyProcomun(
			{ sourceDir: FIXTURES_DIR, dryRun: false },
			deps,
		);

		expect(report.totals.pairsFound).toBe(3);
		expect(report.totals.imported).toBe(3);
		expect(report.totals.blocked).toBe(0);
		expect(report.totals.errored).toBe(0);

		const imported = await deps.repo.findLegacyResourceByExternalId(
			deps.getDb().db,
			"legacy-procomun",
			"1615293421477",
		);
		expect(imported).not.toBeNull();
		if (!imported) return; // la aserción previa ya ha fallado el test; solo estrecha el tipo

		const elpxProject = await getElpxProjectByResourceId(
			deps.getDb().db,
			imported.id,
		);
		expect(elpxProject?.hasPreview).toBe(true);
		// El hash debe ser el checksum SHA-256 real del .elpx (no un UUID
		// aleatorio), condición necesaria para que la deduplicación por
		// contenido documentada en design.md funcione de verdad.
		const realChecksum = await computeFileSha256(
			path.join(FIXTURES_DIR, "1615293421477.elpx"),
		);
		expect(elpxProject?.hash).toBe(realChecksum);

		const media = await listMediaItemsForResource(deps.getDb().db, imported.id);
		expect(media).toHaveLength(1);
		expect(media[0]?.filename).toBe("1615293421477.elpx");

		const [resourceRow] = await deps
			.getDb()
			.db.select({
				createdAt: resources.createdAt,
				searchVector: resources.searchVector,
			})
			.from(resources)
			.where(eq(resources.id, imported.id));
		// createdAt debe reflejar la fecha de publicación original (1615293421477.json
		// -> publicationDate "2021-05-29T13:48:27.339Z"), no el instante de la
		// importación, para no alterar el orden del catálogo público.
		expect(resourceRow?.createdAt.toISOString()).toBe(
			"2021-05-29T13:48:27.339Z",
		);
		// El recurso debe quedar indexado para búsqueda de inmediato, sin
		// depender de una ejecución manual posterior de fts:reindex.
		expect(resourceRow?.searchVector).not.toBeNull();

		// es_2025101012_9102834 combina en origen "no derivadas" (ND) y
		// "compartir igual" (SA), mutuamente excluyentes en las licencias CC
		// reales — se resuelve a cc-by-nc-sa (prioriza SA) en vez de bloquear,
		// con un warning tolerable en el informe (ver ADR-0029).
		const ndSaRecord = report.records.find(
			(r) => r.externalId === "es_2025101012_9102834",
		);
		expect(ndSaRecord?.outcome).toBe("imported");
		expect(
			(ndSaRecord as { warnings?: string[] })?.warnings?.some((w) =>
				w.startsWith("license:"),
			),
		).toBe(true);

		const ndSaResource = await deps.repo.findLegacyResourceByExternalId(
			deps.getDb().db,
			"legacy-procomun",
			"es_2025101012_9102834",
		);
		expect(ndSaResource).not.toBeNull();
		if (!ndSaResource) return;
		const [ndSaRow] = await deps
			.getDb()
			.db.select({ license: resources.license })
			.from(resources)
			.where(eq(resources.id, ndSaResource.id));
		expect(ndSaRow?.license).toBe("cc-by-nc-sa");
	});

	test("la URL pública de preview del recurso importado resuelve 200, no 404 (regresión hallazgo P1 revisión #268)", async () => {
		// No basta con comprobar `extractPath/content.xml` en disco: el bug
		// reportado era justo que el directorio físico de extracción y el
		// identificador público de la preview podían desalinearse (extractPath
		// por uploadId vs. URL pública por checksum). Este test pasa por la
		// ruta HTTP real (elpxContentRoutes, montada como en apps/api/src/app.ts)
		// para verificar el contrato completo, no solo un campo de BD.
		const imported = await deps.repo.findLegacyResourceByExternalId(
			deps.getDb().db,
			"legacy-procomun",
			"1615293421477",
		);
		expect(imported).not.toBeNull();
		if (!imported) return;
		const elpxProject = await getElpxProjectByResourceId(
			deps.getDb().db,
			imported.id,
		);
		expect(elpxProject).not.toBeNull();
		if (!elpxProject) return;
		expect(elpxProject.hasPreview).toBe(true);

		const app = new Hono();
		app.route("/api/v1/elpx", elpxContentRoutes);

		// La URL pública real tal y como la construye buildElpxPreview() a partir
		// de elpx.hash (ver apps/api/src/elpx/preview.ts).
		const res = await app.request(
			`/api/v1/elpx/${elpxProject.hash}/index.html`,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toBe("text/html");
	});

	test("re-ejecutar sobre el mismo directorio es idempotente: 0 nuevos, 3 omitidos", async () => {
		const report = await runImportLegacyProcomun(
			{ sourceDir: FIXTURES_DIR, dryRun: false },
			deps,
		);

		expect(report.totals.imported).toBe(0);
		expect(report.totals.skippedExisting).toBe(3);
		expect(report.totals.blocked).toBe(0);
		expect(report.totals.errored).toBe(0);
	});

	test("--backfill-categories clasifica lo ya importado: en seco no escribe y repetirlo no cambia nada", async () => {
		const db = deps.getDb().db;
		const externalIds = [
			"1615293421477",
			"es_2024052212_9181312",
			"es_2025101012_9102834",
		];
		const ids: string[] = [];
		for (const externalId of externalIds) {
			const found = await deps.repo.findLegacyResourceByExternalId(
				db,
				"legacy-procomun",
				externalId,
			);
			if (found) ids.push(found.id);
		}
		expect(ids).toHaveLength(3);
		const areasOf = () =>
			db
				.select({
					categoryId: resourceEducationalAreas.categoryId,
					optionId: resourceEducationalAreas.optionId,
				})
				.from(resourceEducationalAreas)
				.where(inArray(resourceEducationalAreas.resourceId, ids))
				.orderBy(
					resourceEducationalAreas.categoryId,
					resourceEducationalAreas.optionId,
				);
		const fromImport = await areasOf();
		expect(fromImport).toEqual([
			{ categoryId: "educacion-secundaria-obligatoria", optionId: "eso-3-4" },
			{ categoryId: "educacion-secundaria-obligatoria", optionId: null },
			{ categoryId: "formacion-profesional", optionId: "grado-basico" },
		]);
		// Simula que se importaron antes de la correspondencia (#383).
		await db
			.delete(resourceEducationalAreas)
			.where(inArray(resourceEducationalAreas.resourceId, ids));

		const dry = await runBackfillLegacyEducationalAreas({ dryRun: true }, deps);
		expect(dry.dryRun).toBe(true);
		const ours = (report: typeof dry) =>
			report.categorizacionEducativa.categoriasNoReconocidas.filter((row) =>
				row.recursos.some((id) => externalIds.includes(id)),
			);
		expect(ours(dry)).toEqual([]);
		expect(dry.totals.processed).toBeGreaterThanOrEqual(3);
		expect(await areasOf()).toEqual([]);

		const real = await runBackfillLegacyEducationalAreas(
			{ dryRun: false },
			deps,
		);
		expect(real.categorizacionEducativa).toEqual(dry.categorizacionEducativa);
		expect(await areasOf()).toEqual(fromImport);

		const again = await runBackfillLegacyEducationalAreas(
			{ dryRun: false },
			deps,
		);
		expect(again.totals.processed).toBe(real.totals.processed - 3);
		expect(await areasOf()).toEqual(fromImport);
	});

	test("--only reprocesa un único externalId ya importado como omitido", async () => {
		const report = await runImportLegacyProcomun(
			{ sourceDir: FIXTURES_DIR, dryRun: false, only: "es_2024052212_9181312" },
			deps,
		);

		expect(report.totals.processed).toBe(1);
		expect(report.totals.skippedExisting).toBe(1);
	});
});

describe("import:legacy-procomun — deduplicación por contenido y limpieza de extractPath", () => {
	let deps: Awaited<ReturnType<typeof loadImportLegacyProcomunDependencies>>;
	let dupDir: string;

	beforeAll(async () => {
		process.env.UPLOAD_STORAGE_DIR = await mkdtemp(
			path.join(tmpdir(), "legacy-import-storage-dup-"),
		);
		deps = await loadImportLegacyProcomunDependencies();

		dupDir = await mkdtemp(path.join(tmpdir(), "legacy-import-dup-source-"));
		// Mismo binario .elpx (mismo checksum) bajo dos externalId distintos:
		// ejercita la deduplicación secundaria por contenido documentada en
		// design.md (dos resources.externalId distintos no pueden compartir
		// elpx_projects.hash). Contenido sintético con marker exclusivo de este
		// describe (ver createMinimalElpx): antes se reutilizaba el .elpx del
		// fixture bloqueado por licencia porque su contenido nunca llegaba a
		// extraerse/persistirse, pero desde que normalizeLicense() resuelve la
		// combinación ND+SA en vez de bloquear (ver ADR-0029), ese fixture SÍ se
		// persiste en el describe anterior — reutilizarlo aquí colisionaría con
		// su hash ya insertado (misma BD PGlite compartida por todo el archivo).
		const sourceElpx = path.join(dupDir, "dup-a.elpx");
		await createMinimalElpx(sourceElpx, "dedup-contenido");
		await copyFile(sourceElpx, path.join(dupDir, "dup-b.elpx"));
		for (const [name, externalId] of [
			["dup-a", "es_dup_a"],
			["dup-b", "es_dup_b"],
		] as const) {
			await writeFile(
				path.join(dupDir, `${name}.json`),
				JSON.stringify({
					idODE: externalId,
					titleStr: `Duplicado ${externalId}`,
					descriptionStr:
						"Contenido duplicado para test de deduplicación por hash.",
					generalLanguageStr: ["es"],
					rightsCopyrightAndOtherRestrictionsStr:
						"creative commons: attribution",
					resourceType: ["documento"],
				}),
			);
		}
	});

	test("el segundo recurso con el mismo contenido falla por hash duplicado sin borrar el extractPath del primero", async () => {
		const report = await runImportLegacyProcomun(
			{ sourceDir: dupDir, dryRun: false },
			deps,
		);

		expect(report.totals.processed).toBe(2);
		expect(report.totals.imported).toBe(1);
		expect(report.totals.errored).toBe(1);

		const succeeded = report.records.find((r) => r.outcome === "imported");
		const failed = report.records.find((r) => r.outcome === "error");
		expect(succeeded?.externalId).toBe("es_dup_a"); // orden alfabético: dup-a antes que dup-b
		expect(failed?.externalId).toBe("es_dup_b");
		// El mensaje confirma que la detección ocurrió ANTES de extraer (no un
		// fallo de inserción en BD tras una extracción ya realizada): prueba de
		// que getElpxProjectByHash() se comprueba antes de processElpxUpload().
		expect((failed as { message?: string })?.message).toContain(
			"no se vuelve a extraer",
		);

		const firstResource = await deps.repo.findLegacyResourceByExternalId(
			deps.getDb().db,
			"legacy-procomun",
			"es_dup_a",
		);
		expect(firstResource).not.toBeNull();
		if (!firstResource) return;

		const elpxProject = await getElpxProjectByResourceId(
			deps.getDb().db,
			firstResource.id,
		);
		expect(elpxProject).not.toBeNull();
		if (!elpxProject) return;

		// El extractPath del primer recurso debe seguir intacto: el intento
		// fallido del segundo NO debe haberlo borrado, o rompería la preview del
		// primero, que sigue legítimamente en uso.
		const contentXmlExists = await Bun.file(
			path.join(elpxProject.extractPath, "content.xml"),
		).exists();
		expect(contentXmlExists).toBe(true);

		const secondResource = await deps.repo.findLegacyResourceByExternalId(
			deps.getDb().db,
			"legacy-procomun",
			"es_dup_b",
		);
		expect(secondResource).toBeNull();
	});
});

describe("import:legacy-procomun — carrera real entre dos ejecuciones concurrentes (TOCTOU)", () => {
	let deps: Awaited<ReturnType<typeof loadImportLegacyProcomunDependencies>>;
	let raceDir: string;

	beforeAll(async () => {
		process.env.UPLOAD_STORAGE_DIR = await mkdtemp(
			path.join(tmpdir(), "legacy-import-storage-race-"),
		);
		deps = await loadImportLegacyProcomunDependencies();

		raceDir = await mkdtemp(path.join(tmpdir(), "legacy-import-race-source-"));
		// Contenido sintético nunca antes visto por elpx_projects.hash en este
		// proceso de test (marker exclusivo de este describe — ver
		// createMinimalElpx), necesario para ejercitar la carrera real.
		await createMinimalElpx(
			path.join(raceDir, "race-a.elpx"),
			"carrera-toctou",
		);
		await copyFile(
			path.join(raceDir, "race-a.elpx"),
			path.join(raceDir, "race-b.elpx"),
		);
		for (const [name, externalId] of [
			["race-a", "es_race_a"],
			["race-b", "es_race_b"],
		] as const) {
			await writeFile(
				path.join(raceDir, `${name}.json`),
				JSON.stringify({
					idODE: externalId,
					titleStr: `Carrera ${externalId}`,
					descriptionStr:
						"Contenido idéntico para forzar una carrera real entre dos ejecuciones.",
					generalLanguageStr: ["es"],
					rightsCopyrightAndOtherRestrictionsStr:
						"creative commons: attribution",
					resourceType: ["documento"],
				}),
			);
		}
	});

	test("dos ejecuciones lanzadas con Promise.all sobre el mismo contenido: una gana, la otra falla, ninguna preview se pierde", async () => {
		// Concurrencia real (no mockeada): dos llamadas independientes a
		// runImportLegacyProcomun lanzadas a la vez con Promise.all, cada una
		// filtrando por su propio --only. El interleaving real de las
		// operaciones async (escritura a disco, cálculo de checksum, extracción
		// del ZIP, consultas a PGlite) puede intercalar ambos flujos antes de
		// que cualquiera persista — exactamente el escenario TOCTOU señalado en
		// la revisión del PR #268.
		const [reportA, reportB] = await Promise.all([
			runImportLegacyProcomun(
				{ sourceDir: raceDir, dryRun: false, only: "es_race_a" },
				deps,
			),
			runImportLegacyProcomun(
				{ sourceDir: raceDir, dryRun: false, only: "es_race_b" },
				deps,
			),
		]);

		const totalImported = reportA.totals.imported + reportB.totals.imported;
		const totalErrored = reportA.totals.errored + reportB.totals.errored;
		expect(totalImported).toBe(1);
		expect(totalErrored).toBe(1);

		// Averiguar cuál de los dos ganó (createdAt no sirve como pista fiable
		// aquí porque ambos JSON no traen publicationDate: cae a "now" para
		// ambos) — se identifica por cuál de los dos externalId quedó persistido.
		const winnerExternalId = (await deps.repo.findLegacyResourceByExternalId(
			deps.getDb().db,
			"legacy-procomun",
			"es_race_a",
		))
			? "es_race_a"
			: "es_race_b";

		const winner = await deps.repo.findLegacyResourceByExternalId(
			deps.getDb().db,
			"legacy-procomun",
			winnerExternalId,
		);
		expect(winner).not.toBeNull();
		if (!winner) return;

		const elpxProject = await getElpxProjectByResourceId(
			deps.getDb().db,
			winner.id,
		);
		expect(elpxProject).not.toBeNull();
		if (!elpxProject) return;

		// La preview del recurso que sí ganó la carrera debe seguir intacta: el
		// intento perdedor, al fallar su inserción por la restricción única de
		// hash, no debe haber borrado un directorio de extracción compartido
		// (la garantía de fondo es que, tras el fix, cada intento extrae en su
		// propia ruta única por uploadId, así que no hay nada que compartir).
		const contentXmlExists = await Bun.file(
			path.join(elpxProject.extractPath, "content.xml"),
		).exists();
		expect(contentXmlExists).toBe(true);
	});
});

describe("import:legacy-procomun — estado de publicación del origen (issue #447)", () => {
	let deps: Awaited<ReturnType<typeof loadImportLegacyProcomunDependencies>>;
	let sourceDir: string;

	beforeAll(async () => {
		process.env.UPLOAD_STORAGE_DIR = await mkdtemp(
			path.join(tmpdir(), "legacy-import-storage-published-"),
		);
		deps = await loadImportLegacyProcomunDependencies();

		sourceDir = await mkdtemp(
			path.join(tmpdir(), "legacy-import-published-source-"),
		);
		for (const [name, published] of [
			["no-publicado", 0],
			["sin-published", undefined],
			["publicado", "1"],
		] as const) {
			await createMinimalElpx(
				path.join(sourceDir, `${name}.elpx`),
				`published-${name}`,
			);
			await writeFile(
				path.join(sourceDir, `${name}.json`),
				JSON.stringify({
					idODE: `es_published_${name}`,
					titleStr: `Recurso ${name}`,
					descriptionStr: "Recurso para probar el campo published.",
					generalLanguageStr: ["es"],
					rightsCopyrightAndOtherRestrictionsStr:
						"creative commons: attribution",
					resourceType: ["documento"],
					...(published === undefined ? {} : { published }),
				}),
			);
		}
	});

	async function statusOf(externalId: string) {
		const found = await deps.repo.findLegacyResourceByExternalId(
			deps.getDb().db,
			"legacy-procomun",
			externalId,
		);
		if (!found) return null;
		const [row] = await deps
			.getDb()
			.db.select({ editorialStatus: resources.editorialStatus })
			.from(resources)
			.where(eq(resources.id, found.id));
		return { id: found.id, editorialStatus: row?.editorialStatus };
	}

	test("published: 0 y un valor ausente se importan como borrador, fuera del catálogo público, y el informe lo dice", async () => {
		const report = await runImportLegacyProcomun(
			{ sourceDir, dryRun: false },
			deps,
		);

		expect(report.totals.imported).toBe(3);
		expect(report.totals.importedAsDraft).toBe(2);
		const byId = new Map(
			report.records.map((record) => [record.externalId, record]),
		);
		expect(byId.get("es_published_no-publicado")).toMatchObject({
			outcome: "imported",
			editorialStatus: "draft",
			sourcePublished: 0,
		});
		const absent = byId.get("es_published_sin-published");
		expect(absent).toMatchObject({
			outcome: "imported",
			editorialStatus: "draft",
			sourcePublished: null,
		});
		expect(
			absent && "warnings" in absent
				? absent.warnings.some((w) => w.startsWith("published:"))
				: false,
		).toBe(true);
		expect(byId.get("es_published_publicado")).toMatchObject({
			outcome: "imported",
			editorialStatus: "published",
			sourcePublished: "1",
		});

		expect((await statusOf("es_published_no-publicado"))?.editorialStatus).toBe(
			"draft",
		);
		const listed = await listResources(deps.getDb().db, {
			status: "published",
			limit: 100,
		});
		const draftIds = [
			(await statusOf("es_published_no-publicado"))?.id,
			(await statusOf("es_published_sin-published"))?.id,
		];
		expect(listed.data.some((item) => draftIds.includes(item.id))).toBe(false);
	});

	test("--fix-published pasa a borrador lo importado como publicado sin revisión; en seco no escribe", async () => {
		const db = deps.getDb().db;
		// Simula lo importado antes del arreglo: todo como publicado, y uno ya
		// revisado por un curator después de la importación.
		const ids = await Promise.all(
			["no-publicado", "sin-published"].map(async (name) => {
				const found = await statusOf(`es_published_${name}`);
				if (!found) throw new Error(`falta es_published_${name}`);
				return found.id;
			}),
		);
		await db
			.update(resources)
			.set({ editorialStatus: "published" })
			.where(inArray(resources.id, ids));
		await db
			.update(resources)
			.set({ curatedAt: new Date() })
			.where(eq(resources.id, ids[1] as string));

		const dry = await runFixLegacyPublished({ sourceDir, dryRun: true }, deps);
		expect(dry.totals).toEqual({
			processed: 3,
			publishedAtSource: 1,
			unpublished: 1,
			reviewed: 1,
			notPublished: 0,
			notFound: 0,
			errored: 0,
		});
		expect(dry.records).toContainEqual({
			externalId: "es_published_no-publicado",
			sourcePublished: 0,
			outcome: "would_unpublish",
			resourceId: ids[0] as string,
		});
		expect((await statusOf("es_published_no-publicado"))?.editorialStatus).toBe(
			"published",
		);

		const real = await runFixLegacyPublished(
			{ sourceDir, dryRun: false },
			deps,
		);
		expect(real.totals.unpublished).toBe(1);
		expect(real.records).toContainEqual({
			externalId: "es_published_sin-published",
			sourcePublished: null,
			outcome: "reviewed",
			resourceId: ids[1] as string,
		});
		expect((await statusOf("es_published_no-publicado"))?.editorialStatus).toBe(
			"draft",
		);
		expect(
			(await statusOf("es_published_sin-published"))?.editorialStatus,
		).toBe("published");
		expect((await statusOf("es_published_publicado"))?.editorialStatus).toBe(
			"published",
		);

		const again = await runFixLegacyPublished(
			{ sourceDir, dryRun: false },
			deps,
		);
		expect(again.totals.unpublished).toBe(0);
		expect(again.totals.notPublished).toBe(1);
	});
});

// Issue #473: lo importado antes del arreglo recibió "es" sin idioma en origen.
describe("import:legacy-procomun — idioma sin valor en origen (issue #473)", () => {
	let deps: Awaited<ReturnType<typeof loadImportLegacyProcomunDependencies>>;
	let sourceDir: string;
	const SOURCES = {
		"sin-idioma": { educationalLanguageStr: ["es"] },
		valenciano: { generalLanguageStr: ["va"] },
		ingles: { generalLanguageStr: ["en"] },
		editado: {},
	} as const;

	beforeAll(async () => {
		process.env.UPLOAD_STORAGE_DIR = await mkdtemp(
			path.join(tmpdir(), "legacy-import-storage-language-"),
		);
		deps = await loadImportLegacyProcomunDependencies();
		sourceDir = await mkdtemp(path.join(tmpdir(), "legacy-import-language-"));
		for (const [name, language] of Object.entries(SOURCES)) {
			await createMinimalElpx(
				path.join(sourceDir, `${name}.elpx`),
				`language-${name}`,
			);
			await writeFile(
				path.join(sourceDir, `${name}.json`),
				JSON.stringify({
					idODE: `es_language_${name}`,
					titleStr: `Recurso ${name}`,
					descriptionStr: "Recurso para probar el idioma de origen.",
					rightsCopyrightAndOtherRestrictionsStr:
						"creative commons: attribution",
					resourceType: ["documento"],
					published: 1,
					...language,
				}),
			);
		}
	});

	async function languageOf(name: string) {
		const [row] = await deps
			.getDb()
			.db.select({ language: resources.language })
			.from(resources)
			.where(eq(resources.externalId, `es_language_${name}`));
		return row?.language;
	}

	test("se importa sin idioma lo que no lo trae y «va» como catalán", async () => {
		await runImportLegacyProcomun({ sourceDir, dryRun: false }, deps);
		expect(await languageOf("sin-idioma")).toBeNull();
		expect(await languageOf("valenciano")).toBe("ca");
		expect(await languageOf("ingles")).toBe("en");
	});

	test("--fix-language quita el «es» por defecto y respeta un idioma editado; en seco no escribe", async () => {
		const db = deps.getDb().db;
		// Simula lo importado antes del arreglo: "es" por defecto, y uno
		// editado a mano después a gallego.
		await db
			.update(resources)
			.set({ language: "es" })
			.where(
				inArray(resources.externalId, [
					"es_language_sin-idioma",
					"es_language_valenciano",
				]),
			);
		await db
			.update(resources)
			.set({ language: "gl" })
			.where(eq(resources.externalId, "es_language_editado"));

		const dry = await runFixLegacyLanguage({ sourceDir, dryRun: true }, deps);
		expect(dry.totals).toEqual({
			processed: 4,
			fixed: 2,
			unchanged: 1,
			kept: 1,
			notFound: 0,
			errored: 0,
		});
		expect(dry.records).toContainEqual(
			expect.objectContaining({
				externalId: "es_language_sin-idioma",
				outcome: "would_fix",
				from: "es",
				to: null,
			}),
		);
		expect(await languageOf("sin-idioma")).toBe("es");

		const real = await runFixLegacyLanguage({ sourceDir, dryRun: false }, deps);
		expect(real.totals.fixed).toBe(2);
		expect(await languageOf("sin-idioma")).toBeNull();
		expect(await languageOf("valenciano")).toBe("ca");
		expect(await languageOf("ingles")).toBe("en");
		expect(await languageOf("editado")).toBe("gl");

		const again = await runFixLegacyLanguage(
			{ sourceDir, dryRun: false },
			deps,
		);
		expect(again.totals.fixed).toBe(0);
	});
});
