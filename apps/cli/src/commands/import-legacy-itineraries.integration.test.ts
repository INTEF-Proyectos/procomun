import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	spyOn,
	test,
} from "bun:test";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
	ensureLegacyImportSystemUser,
	LEGACY_IMPORT_SYSTEM_USER_ID,
	mapLegacyItinerary,
} from "@procomun/db/legacy-import";
import {
	createCatalogKeyword,
	findLegacyCollectionOwnerAccount,
	getCollectionById,
	importLegacyCollection,
	LEGACY_USER_ID_PREFIX,
	loadLegacyCollectionMetadataCatalog,
} from "@procomun/db/repository";
import * as schema from "@procomun/db/schema";
import { createTables } from "@procomun/db/setup";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import {
	type loadImportLegacyItinerariesDependencies,
	parseImportLegacyItinerariesArgs,
	runImportLegacyItineraries,
	runImportLegacyItinerariesCommand,
} from "./import-legacy-itineraries.ts";

type Deps = Awaited<ReturnType<typeof loadImportLegacyItinerariesDependencies>>;

// JSON real del exportador (#432), con quien publica anonimizado. El correo
// del itinerario 2 lleva mayúsculas y un espacio al final a propósito.
const SOURCE_FILE = path.join(
	import.meta.dir,
	"../test-fixtures/legacy-itineraries/itinerarios.json",
);
const IT1 = "5FCZLpYBAcddN1-Hc4ZU";
const IT2 = "zKIXqJ8BL0sscyf8tW7W";
// Los ODE que jacoboAlcantara adjuntó a la issue. Falta, como en el caso
// real, el artículo del itinerario 1 (eVC1LpYBAcddN1-HHKC-), que el exportador
// no sacó, y aquí también el podcast del 2 (es_2026073112_9091303).
const IMPORTED_RESOURCES = [
	"es_2025041312_9101210",
	"es_2026073112_9085355",
	"es_2026073112_9085905",
	"es_2026073112_9132300",
	"es_2026073112_9134804",
];

describe("import:legacy-itineraries (integración con PGlite)", () => {
	let pglite: PGlite;
	let db: ReturnType<typeof drizzle<typeof schema>>;
	let dir: string;
	let logs: string[];
	let spies: Array<{ mockRestore: () => void }>;

	function deps(): Deps {
		// El comando cierra el cliente al terminar (closeCliDb). La base se
		// comparte entre tests, así que se le oculta el cliente.
		const shared = new Proxy(db, {
			has: (target, key) => key !== "$client" && key in target,
		});
		return {
			getDb: () => ({ db: shared, provider: "pglite" }),
			waitForDb: async () => {},
			mapLegacyItinerary,
			findLegacyCollectionOwnerAccount,
			importLegacyCollection,
			loadLegacyCollectionMetadataCatalog,
			ensureLegacyImportSystemUser,
			LEGACY_USER_ID_PREFIX,
		} as unknown as Deps;
	}

	// Una sola base para el fichero (createTables tarda varios segundos) que se
	// vacía antes de cada test.
	beforeAll(async () => {
		pglite = new PGlite();
		await createTables(pglite);
		db = drizzle(pglite, { schema });
	}, 60_000);

	afterAll(async () => {
		await pglite.close();
	});

	beforeEach(async () => {
		await pglite.exec(`
			ALTER TABLE collections DROP CONSTRAINT IF EXISTS test_rechaza_coleccion;
			DELETE FROM collection_resources;
			DELETE FROM collections;
			DELETE FROM resources;
			DELETE FROM "user";
		`);
		dir = await mkdtemp(path.join(tmpdir(), "legacy-itineraries-"));
		for (const externalId of IMPORTED_RESOURCES) {
			await db.insert(schema.resources).values({
				id: `res-${externalId}`,
				slug: `res-${externalId}`,
				title: externalId,
				description: "d",
				language: "es",
				license: "cc-by",
				resourceType: "documento",
				editorialStatus: "published",
				importSource: "legacy-procomun",
				externalId,
			});
		}
		// Cuenta creada por el importador de usuarios (#488) para el autor del
		// itinerario 2. El del itinerario 1 no tiene cuenta.
		await db.insert(schema.user).values({
			id: `${LEGACY_USER_ID_PREFIX}136`,
			email: "Docente.Itinerario.Dos@ejemplo.test",
			name: "Docente Itinerario Dos",
			role: "editor",
		});
		logs = [];
		const capture = (...args: unknown[]) => {
			logs.push(args.map(String).join(" "));
		};
		spies = [
			spyOn(console, "log").mockImplementation(capture),
			spyOn(console, "warn").mockImplementation(capture),
			spyOn(console, "error").mockImplementation(capture),
		];
	});

	afterEach(() => {
		for (const spy of spies) spy.mockRestore();
	});

	async function collection(externalId: string) {
		const [row] = await db
			.select()
			.from(schema.collections)
			.where(eq(schema.collections.externalId, externalId));
		return row;
	}

	async function resourceOrder(collectionId: string) {
		const rows = await db
			.select({ resourceId: schema.collectionResources.resourceId })
			.from(schema.collectionResources)
			.where(eq(schema.collectionResources.collectionId, collectionId))
			.orderBy(asc(schema.collectionResources.position));
		return rows.map((row) => row.resourceId.replace(/^res-/, ""));
	}

	test("importa los dos itinerarios reales como colecciones, con su propietario y sus recursos en orden", async () => {
		const reportDir = path.join(dir, "informes");
		const exitCode = await runImportLegacyItinerariesCommand(
			parseImportLegacyItinerariesArgs([
				"--source-file",
				SOURCE_FILE,
				"--report-dir",
				reportDir,
			]),
			deps(),
		);
		expect(exitCode).toBe(0);
		expect(await db.select().from(schema.collections)).toHaveLength(2);

		// Itinerario 2: cuenta encontrada por correo, publicado, cuatro ODE en el
		// orden del JSON y el podcast omitido.
		const second = await collection(IT2);
		expect(second).toMatchObject({
			title: "Alimentación animal. Gestión de la Producción Animal - RA 3",
			curatorId: `${LEGACY_USER_ID_PREFIX}136`,
			editorialStatus: "published",
			isOrdered: true,
			importSource: "legacy-procomun",
		});
		expect(second?.publishedAt?.toISOString()).toBe("2026-07-31T15:58:26.000Z");
		expect(await resourceOrder(second?.id ?? "")).toEqual([
			"es_2026073112_9085355",
			"es_2026073112_9085905",
			"es_2026073112_9132300",
			"es_2026073112_9134804",
		]);

		// Itinerario 1: sin cuenta, borrador a nombre del sistema; el ODE entra y
		// el artículo que no se exportó se omite.
		const first = await collection(IT1);
		expect(first?.curatorId).toBe(LEGACY_IMPORT_SYSTEM_USER_ID);
		expect(first?.editorialStatus).toBe("draft");
		expect(first?.description).toContain(
			"Pixabay\n\nArtículo con las instrucciones\nRecurso con los archivos",
		);
		expect(await resourceOrder(first?.id ?? "")).toEqual([
			"es_2025041312_9101210",
		]);

		const [reportName] = await readdir(reportDir);
		expect(reportName).toMatch(/^informe_itinerarios-.+\.json$/);
		const reportText = await Bun.file(
			path.join(reportDir, reportName ?? ""),
		).text();
		// Sin correos ni nombres de quien publica (#543).
		expect(reportText).not.toMatch(/@/);
		expect(reportText).not.toContain("Docente");
		const report = JSON.parse(reportText);
		expect(report.totals).toMatchObject({
			found: 2,
			processed: 2,
			created: 2,
			updated: 0,
			unchanged: 0,
			blocked: 0,
			errored: 0,
			withoutOwner: 1,
			missingResources: 2,
			discardedMetadata: {
				knowledgeArea: 1,
				labelsStr: 2,
				learningContext: 0,
				educationalDescription: 0,
			},
		});
		const byId = Object.fromEntries(
			report.records.map((r: { itineraryId: string }) => [r.itineraryId, r]),
		);
		expect(byId[IT1]).toMatchObject({
			outcome: "created",
			owner: "system",
			ownerReason: "no_account",
			linkedResources: 1,
			missingResources: [
				{
					externalId: "eVC1LpYBAcddN1-HHKC-",
					kind: "article",
					reason: "not_imported",
				},
			],
			discardedFields: ["labelsStr"],
		});
		expect(byId[IT2]).toMatchObject({
			outcome: "created",
			owner: "owner",
			linkedResources: 4,
			missingResources: [
				{
					externalId: "es_2026073112_9091303",
					kind: "ode",
					reason: "not_imported",
				},
			],
		});
		expect(byId[IT2].ownerReason).toBeUndefined();
		expect(logs.join("\n")).toContain(
			`[recurso no encontrado] itinerario ${IT1}: eVC1LpYBAcddN1-HHKC- (artículo)`,
		);
		expect(logs.join("\n")).not.toMatch(/@/);
	});

	test("resuelve los metadatos del itinerario, informa los valores sin correspondencia y reimporta sin duplicar", async () => {
		const term = await createCatalogKeyword(db, {
			label: "Mecanizado de prueba",
			aliases: ["Mecanizado", "Fabricación y montaje"],
			createdBy: `${LEGACY_USER_ID_PREFIX}136`,
		});
		if (term.status === "invalid") throw new Error("catálogo inválido");

		const sourceFile = path.join(dir, "metadatos.json");
		const itinerary = {
			id: "it-metadatos",
			titleStr: "Itinerario de prueba",
			descriptionStr: "Descripción general",
			knowledgeArea: ["Tecnologías", "Área sin correspondencia"],
			labelsStr: [
				"mecanizado",
				"mecánica, electricidad, dibujo técnico, Leonardo Da Vinci",
				"herramientas del taller de tecnología",
				"máquinas eléctricas",
				"fabricación y montaje",
				"taller",
			],
			learningContext: ["Formación Profesional Básica (más de 15 años)"],
			educationalDescription: [""],
		};
		await Bun.write(sourceFile, JSON.stringify([itinerary]));

		const dryRun = await runImportLegacyItineraries(
			{ sourceFile, dryRun: true },
			deps(),
		);
		expect(dryRun.records[0]).toMatchObject({
			outcome: "would_create",
			metadataIssues: {
				knowledgeArea: { unmatched: 1 },
				labelsStr: { unmatched: 7 },
			},
		});
		expect(await collection(itinerary.id)).toBeUndefined();

		await runImportLegacyItineraries({ sourceFile, dryRun: false }, deps());
		const first = await collection(itinerary.id);
		expect(first?.description).toBe("Descripción general");
		const details = await getCollectionById(db, first?.id ?? "");
		expect(details?.knowledgeAreas.map(({ id }) => id)).toEqual(["tecnologia"]);
		expect(details?.catalogKeywords.map(({ id }) => id)).toEqual([
			term.keyword.id,
		]);
		expect(details?.educationalAreas).toEqual([
			{ categoryId: "formacion-profesional", optionId: "grado-basico" },
		]);

		await Bun.write(
			sourceFile,
			JSON.stringify([
				{
					...itinerary,
					educationalDescription: ["", "<p>Práctica de taller</p>"],
				},
			]),
		);
		const update = await runImportLegacyItineraries(
			{ sourceFile, dryRun: false },
			deps(),
		);
		expect(update.records[0]).toMatchObject({ outcome: "updated" });
		const unchanged = await runImportLegacyItineraries(
			{ sourceFile, dryRun: false },
			deps(),
		);
		expect(unchanged.records[0]).toMatchObject({ outcome: "unchanged" });
		expect((await collection(itinerary.id))?.description).toBe(
			"Descripción general\n\nPráctica de taller",
		);
		expect(
			(await getCollectionById(db, first?.id ?? ""))?.catalogKeywords.map(
				({ id }) => id,
			),
		).toEqual([term.keyword.id]);
	});

	test("es idempotente: la segunda pasada no duplica ni cambia nada", async () => {
		await runImportLegacyItineraries(
			{ sourceFile: SOURCE_FILE, dryRun: false },
			deps(),
		);
		const before = await db.select().from(schema.collections);

		const again = await runImportLegacyItineraries(
			{ sourceFile: SOURCE_FILE, dryRun: false },
			deps(),
		);
		expect(again.totals).toMatchObject({ created: 0, unchanged: 2 });
		const after = await db.select().from(schema.collections);
		expect(after).toHaveLength(2);
		expect(after.map((row) => [row.id, row.slug, row.updatedAt])).toEqual(
			before.map((row) => [row.id, row.slug, row.updatedAt]),
		);
	});

	test("--dry-run no escribe; --only y --limit acotan los itinerarios", async () => {
		const dry = await runImportLegacyItineraries(
			{ sourceFile: SOURCE_FILE, dryRun: true },
			deps(),
		);
		expect(dry.totals).toMatchObject({ wouldCreate: 2, created: 0 });
		expect(await db.select().from(schema.collections)).toHaveLength(0);
		// En seco tampoco se crea el usuario de sistema.
		expect(
			await db
				.select()
				.from(schema.user)
				.where(eq(schema.user.id, LEGACY_IMPORT_SYSTEM_USER_ID)),
		).toHaveLength(0);

		const only = await runImportLegacyItineraries(
			{ sourceFile: SOURCE_FILE, dryRun: false, only: IT2 },
			deps(),
		);
		expect(only.totals).toMatchObject({ processed: 1, created: 1 });
		expect(only.records.map((r) => r.itineraryId)).toEqual([IT2]);

		const limited = await runImportLegacyItineraries(
			{ sourceFile: SOURCE_FILE, dryRun: false, limit: 1 },
			deps(),
		);
		expect(limited.records.map((r) => r.itineraryId)).toEqual([IT1]);
	});

	test("una cuenta dada de baja no recibe la colección; una bloqueada sí", async () => {
		await db
			.update(schema.user)
			.set({ deletedAt: new Date() })
			.where(eq(schema.user.id, `${LEGACY_USER_ID_PREFIX}136`));
		const deleted = await runImportLegacyItineraries(
			{ sourceFile: SOURCE_FILE, dryRun: true, only: IT2 },
			deps(),
		);
		expect(deleted.records[0]).toMatchObject({
			owner: "system",
			ownerReason: "deleted_account",
		});

		await db
			.update(schema.user)
			.set({ deletedAt: null, banned: true })
			.where(eq(schema.user.id, `${LEGACY_USER_ID_PREFIX}136`));
		const banned = await runImportLegacyItineraries(
			{ sourceFile: SOURCE_FILE, dryRun: true, only: IT2 },
			deps(),
		);
		expect(banned.records[0]).toMatchObject({ owner: "owner" });
	});

	test("una cuenta sin verificar que no creó el importador de usuarios no recibe la colección", async () => {
		await db
			.update(schema.user)
			.set({ id: "registrada-a-mano", emailVerified: false })
			.where(eq(schema.user.id, `${LEGACY_USER_ID_PREFIX}136`));
		const report = await runImportLegacyItineraries(
			{ sourceFile: SOURCE_FILE, dryRun: true, only: IT2 },
			deps(),
		);
		expect(report.records[0]).toMatchObject({
			owner: "system",
			ownerReason: "unverified_account",
		});
	});

	test("un error de la base de datos sale resumido, sin la consulta ni el correo", async () => {
		await pglite.exec(
			"ALTER TABLE collections ADD CONSTRAINT test_rechaza_coleccion CHECK (title NOT LIKE 'Alimentación%')",
		);
		const report = await runImportLegacyItineraries(
			{ sourceFile: SOURCE_FILE, dryRun: false },
			deps(),
		);
		expect(report.totals).toMatchObject({ created: 1, errored: 1 });
		const failed = report.records.find((r) => r.outcome === "error");
		expect(failed).toEqual({
			outcome: "error",
			index: 1,
			itineraryId: IT2,
			code: "constraint_violation",
			message: "la base de datos rechazó el registro por una restricción",
			sqlState: "23514",
			constraint: "test_rechaza_coleccion",
		});
		expect(JSON.stringify(report)).not.toMatch(/@|insert into/i);
		expect(logs.join("\n")).not.toMatch(/@|insert into/i);
	});
});
