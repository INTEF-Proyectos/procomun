import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

		const media = await deps.repo.listMediaItemsForResource(deps.getDb().db, imported!.id);
		expect(media).toHaveLength(1);
		expect(media[0]?.filename).toBe("1615293421477.elpx");
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
