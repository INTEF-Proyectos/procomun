import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { resources } from "@procomun/db/schema";
import { computeFileSha256 } from "../../../api/src/uploads/config.ts";
import {
	loadImportLegacyProcomunDependencies,
	runImportLegacyProcomun,
} from "./import-legacy-procomun.ts";

// Fixtures versionadas (anonimizadas, ver ADR-0029): 3 pares .json+.elpx reales
// de ode-export/, uno de ellos (es_2025101012_9102834) con una combinación de
// licencia CC inexistente ("non derived" + "share alike") a propósito, para
// probar el camino bloqueante end-to-end.
const FIXTURES_DIR = path.join(import.meta.dir, "../test-fixtures/legacy-procomun");

describe("import:legacy-procomun (integración, PGlite en memoria vía test-setup.ts)", () => {
	let deps: Awaited<ReturnType<typeof loadImportLegacyProcomunDependencies>>;

	beforeAll(async () => {
		process.env.UPLOAD_STORAGE_DIR = await mkdtemp(path.join(tmpdir(), "legacy-import-storage-"));
		deps = await loadImportLegacyProcomunDependencies();
	});

	test("--dry-run no persiste nada en base de datos", async () => {
		const report = await runImportLegacyProcomun({ sourceDir: FIXTURES_DIR, dryRun: true }, deps);

		expect(report.totals.pairsFound).toBe(3);
		expect(report.totals.blocked).toBe(1); // es_2025101012_9102834: licencia inválida
		expect(report.totals.imported).toBe(2); // would_import
		expect(report.records.filter((r) => r.outcome === "would_import")).toHaveLength(2);

		const stillMissing = await deps.repo.findLegacyResourceByExternalId(
			deps.getDb().db,
			"legacy-procomun",
			"es_2024052212_9181312",
		);
		expect(stillMissing).toBeNull();
	});

	test("una ejecución real importa los pares válidos y bloquea el de licencia inválida", async () => {
		const report = await runImportLegacyProcomun({ sourceDir: FIXTURES_DIR, dryRun: false }, deps);

		expect(report.totals.pairsFound).toBe(3);
		expect(report.totals.imported).toBe(2);
		expect(report.totals.blocked).toBe(1);
		expect(report.totals.errored).toBe(0);

		const blockedRecord = report.records.find((r) => r.outcome === "blocked");
		expect(blockedRecord?.externalId).toBe("es_2025101012_9102834");

		const imported = await deps.repo.findLegacyResourceByExternalId(
			deps.getDb().db,
			"legacy-procomun",
			"1615293421477",
		);
		expect(imported).not.toBeNull();

		const elpxProject = await deps.repo.getElpxProjectByResourceId(deps.getDb().db, imported!.id);
		expect(elpxProject?.hasPreview).toBe(true);
		// El hash debe ser el checksum SHA-256 real del .elpx (no un UUID
		// aleatorio), condición necesaria para que la deduplicación por
		// contenido documentada en design.md funcione de verdad.
		const realChecksum = await computeFileSha256(path.join(FIXTURES_DIR, "1615293421477.elpx"));
		expect(elpxProject?.hash).toBe(realChecksum);

		const media = await deps.repo.listMediaItemsForResource(deps.getDb().db, imported!.id);
		expect(media).toHaveLength(1);
		expect(media[0]?.filename).toBe("1615293421477.elpx");

		const [resourceRow] = await deps
			.getDb()
			.db.select({ createdAt: resources.createdAt, searchVector: resources.searchVector })
			.from(resources)
			.where(eq(resources.id, imported!.id));
		// createdAt debe reflejar la fecha de publicación original (1615293421477.json
		// -> publicationDate "2021-05-29T13:48:27.339Z"), no el instante de la
		// importación, para no alterar el orden del catálogo público.
		expect(resourceRow?.createdAt.toISOString()).toBe("2021-05-29T13:48:27.339Z");
		// El recurso debe quedar indexado para búsqueda de inmediato, sin
		// depender de una ejecución manual posterior de fts:reindex.
		expect(resourceRow?.searchVector).not.toBeNull();
	});

	test("re-ejecutar sobre el mismo directorio es idempotente: 0 nuevos, 2 omitidos", async () => {
		const report = await runImportLegacyProcomun({ sourceDir: FIXTURES_DIR, dryRun: false }, deps);

		expect(report.totals.imported).toBe(0);
		expect(report.totals.skippedExisting).toBe(2);
		expect(report.totals.blocked).toBe(1);
		expect(report.totals.errored).toBe(0);
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
		process.env.UPLOAD_STORAGE_DIR = await mkdtemp(path.join(tmpdir(), "legacy-import-storage-dup-"));
		deps = await loadImportLegacyProcomunDependencies();

		dupDir = await mkdtemp(path.join(tmpdir(), "legacy-import-dup-source-"));
		// Mismo binario .elpx (mismo checksum) bajo dos externalId distintos:
		// ejercita la deduplicación secundaria por contenido documentada en
		// design.md (dos resources.externalId distintos no pueden compartir
		// elpx_projects.hash). Se reutiliza el .elpx del fixture bloqueado por
		// licencia (es_2025101012_9102834): su contenido nunca llega a
		// persistirse en el resto de la suite, así que no colisiona con hashes
		// ya insertados por el describe anterior (misma BD PGlite compartida
		// dentro del proceso de test).
		const sourceElpx = path.join(FIXTURES_DIR, "es_2025101012_9102834.elpx");
		await copyFile(sourceElpx, path.join(dupDir, "dup-a.elpx"));
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
					descriptionStr: "Contenido duplicado para test de deduplicación por hash.",
					generalLanguageStr: ["es"],
					rightsCopyrightAndOtherRestrictionsStr: "creative commons: attribution",
					resourceType: ["documento"],
				}),
			);
		}
	});

	test("el segundo recurso con el mismo contenido falla por hash duplicado sin borrar el extractPath del primero", async () => {
		const report = await runImportLegacyProcomun({ sourceDir: dupDir, dryRun: false }, deps);

		expect(report.totals.processed).toBe(2);
		expect(report.totals.imported).toBe(1);
		expect(report.totals.errored).toBe(1);

		const succeeded = report.records.find((r) => r.outcome === "imported");
		const failed = report.records.find((r) => r.outcome === "error");
		expect(succeeded?.externalId).toBe("es_dup_a"); // orden alfabético: dup-a antes que dup-b
		expect(failed?.externalId).toBe("es_dup_b");

		const firstResource = await deps.repo.findLegacyResourceByExternalId(
			deps.getDb().db,
			"legacy-procomun",
			"es_dup_a",
		);
		expect(firstResource).not.toBeNull();

		const elpxProject = await deps.repo.getElpxProjectByResourceId(deps.getDb().db, firstResource!.id);
		expect(elpxProject).not.toBeNull();

		// El extractPath del primer recurso debe seguir intacto: el intento
		// fallido del segundo NO debe haberlo borrado, o rompería la preview del
		// primero, que sigue legítimamente en uso.
		const contentXmlExists = await Bun.file(path.join(elpxProject!.extractPath, "content.xml")).exists();
		expect(contentXmlExists).toBe(true);

		const secondResource = await deps.repo.findLegacyResourceByExternalId(
			deps.getDb().db,
			"legacy-procomun",
			"es_dup_b",
		);
		expect(secondResource).toBeNull();
	});
});
