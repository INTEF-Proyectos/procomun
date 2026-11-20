import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import {
	type MappedLegacyItinerary,
	mapLegacyItinerary,
} from "../legacy-import/itinerary.ts";
import {
	ensureLegacyImportSystemUser,
	LEGACY_IMPORT_SYSTEM_USER_ID,
} from "../legacy-import/system-user.ts";
import * as schema from "../schema/index.ts";
import { createTables } from "../setup.ts";
import {
	findLegacyCollectionOwnerAccount,
	importLegacyCollection,
} from "./legacy-collections.ts";
import type { DrizzleDB } from "./shared.ts";

describe("importación de itinerarios como colecciones (#432)", () => {
	let pglite: PGlite;
	let db: DrizzleDB;

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
			DELETE FROM collection_resources;
			DELETE FROM collections;
			DELETE FROM resources;
			DELETE FROM "user";
		`);
		await ensureLegacyImportSystemUser(db);
	});

	async function addUser(
		id: string,
		email: string,
		extra: Partial<typeof schema.user.$inferInsert> = {},
	) {
		await db.insert(schema.user).values({
			id,
			email,
			name: id,
			role: "editor",
			emailVerified: true,
			...extra,
		});
	}

	async function addResource(externalId: string, deleted = false) {
		const id = `res-${externalId}`;
		await db.insert(schema.resources).values({
			id,
			slug: id,
			title: externalId,
			description: "d",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			editorialStatus: "published",
			importSource: "legacy-procomun",
			externalId,
			deletedAt: deleted ? new Date() : null,
		});
		return id;
	}

	function itinerary(
		overrides: Record<string, unknown> = {},
	): MappedLegacyItinerary {
		const mapped = mapLegacyItinerary({
			id: "it-1",
			titleStr: "Itinerario de prueba",
			descriptionStr: "Descripción",
			published: 1,
			publicationDate: "2025-04-13T12:02:58.000Z",
			publicatorEmailStr: "autora@ejemplo.test",
			itineraryContent: { es_a: "A", es_b: "B" },
			interestContent: { art_c: "C" },
			...overrides,
		}).mapped;
		if (!mapped) throw new Error("mapeo bloqueado");
		return mapped;
	}

	async function collectionRows() {
		return db.select().from(schema.collections);
	}

	async function linkedResources(collectionId: string) {
		return db
			.select({
				resourceId: schema.collectionResources.resourceId,
				position: schema.collectionResources.position,
			})
			.from(schema.collectionResources)
			.where(eq(schema.collectionResources.collectionId, collectionId))
			.orderBy(asc(schema.collectionResources.position));
	}

	describe("findLegacyCollectionOwnerAccount", () => {
		test("encuentra la cuenta sin distinguir mayúsculas ni espacios", async () => {
			await addUser("u-1", "Autora@Ejemplo.test");
			expect(
				await findLegacyCollectionOwnerAccount(db, " autora@EJEMPLO.test "),
			).toEqual({ id: "u-1", deleted: false, emailVerified: true });
		});

		test("marca la cuenta dada de baja y no devuelve el usuario de sistema", async () => {
			await addUser("u-baja", "baja@ejemplo.test", { deletedAt: new Date() });
			expect(
				(await findLegacyCollectionOwnerAccount(db, "baja@ejemplo.test"))
					?.deleted,
			).toBe(true);
			expect(
				await findLegacyCollectionOwnerAccount(
					db,
					"legacy-procomun-import@system.local",
				),
			).toBeNull();
			expect(await findLegacyCollectionOwnerAccount(db, "  ")).toBeNull();
		});
	});

	test("crea la colección del autor con los recursos importados, en orden, y omite los que faltan", async () => {
		await addUser("u-1", "autora@ejemplo.test");
		const a = await addResource("es_a");
		const c = await addResource("art_c");

		const result = await importLegacyCollection(
			db,
			{ itinerary: itinerary(), ownerId: "u-1" },
			{ dryRun: false },
		);

		expect(result.outcome).toBe("created");
		expect(result.owner).toBe("owner");
		expect(result.missingResources).toEqual([
			{ externalId: "es_b", kind: "ode", reason: "not_imported" },
		]);
		const [row] = await collectionRows();
		expect(row).toMatchObject({
			id: result.collectionId,
			title: "Itinerario de prueba",
			description: "Descripción",
			editorialStatus: "published",
			curatorId: "u-1",
			isOrdered: true,
			importSource: "legacy-procomun",
			externalId: "it-1",
		});
		expect(row?.publishedAt?.toISOString()).toBe("2025-04-13T12:02:58.000Z");
		expect(row?.slug).toMatch(/^itinerario-de-prueba-[0-9a-f]{8}$/);
		expect(await linkedResources(row?.id ?? "")).toEqual([
			{ resourceId: a, position: 0 },
			{ resourceId: c, position: 1 },
		]);
	});

	test("sin cuenta queda en borrador a nombre del usuario de sistema", async () => {
		const result = await importLegacyCollection(
			db,
			{ itinerary: itinerary(), ownerId: null },
			{ dryRun: false },
		);

		expect(result.owner).toBe("system");
		const [row] = await collectionRows();
		expect(row?.curatorId).toBe(LEGACY_IMPORT_SYSTEM_USER_ID);
		expect(row?.editorialStatus).toBe("draft");
	});

	test("un recurso dado de baja se omite como borrado", async () => {
		await addResource("es_a", true);
		const result = await importLegacyCollection(
			db,
			{ itinerary: itinerary({ interestContent: {} }), ownerId: null },
			{ dryRun: false },
		);
		expect(result.missingResources).toEqual([
			{ externalId: "es_a", kind: "ode", reason: "deleted" },
			{ externalId: "es_b", kind: "ode", reason: "not_imported" },
		]);
	});

	test("en seco no escribe nada", async () => {
		await addUser("u-1", "autora@ejemplo.test");
		const result = await importLegacyCollection(
			db,
			{ itinerary: itinerary(), ownerId: "u-1" },
			{ dryRun: true },
		);
		expect(result.outcome).toBe("would_create");
		expect(result.collectionId).toBeNull();
		expect(await collectionRows()).toHaveLength(0);
	});

	test("reimportar no duplica, actualiza el contenido y los recursos y conserva el slug", async () => {
		await addUser("u-1", "autora@ejemplo.test");
		await addResource("es_a");
		const first = await importLegacyCollection(
			db,
			{ itinerary: itinerary(), ownerId: "u-1" },
			{ dryRun: false },
		);
		const [before] = await collectionRows();

		const again = await importLegacyCollection(
			db,
			{ itinerary: itinerary(), ownerId: "u-1" },
			{ dryRun: false },
		);
		expect(again.outcome).toBe("unchanged");
		expect(again.collectionId).toBe(first.collectionId);

		// Más tarde llega el ODE que faltaba y cambia el título en origen.
		const b = await addResource("es_b");
		const updated = await importLegacyCollection(
			db,
			{
				itinerary: itinerary({ titleStr: "Título nuevo" }),
				ownerId: "u-1",
			},
			{ dryRun: false },
		);
		expect(updated.outcome).toBe("updated");
		const rows = await collectionRows();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.title).toBe("Título nuevo");
		expect(rows[0]?.slug).toBe(before?.slug ?? "");
		expect(
			(await linkedResources(rows[0]?.id ?? "")).map((r) => r.resourceId),
		).toEqual(["res-es_a", b]);
	});

	test("no cambia un propietario reasignado a mano ni el estado editorial", async () => {
		await addUser("u-1", "autora@ejemplo.test");
		await addUser("u-otra", "otra@ejemplo.test", { role: "curator" });
		const first = await importLegacyCollection(
			db,
			{ itinerary: itinerary(), ownerId: "u-1" },
			{ dryRun: false },
		);
		await db
			.update(schema.collections)
			.set({ curatorId: "u-otra", editorialStatus: "archived" })
			.where(eq(schema.collections.id, first.collectionId ?? ""));

		const again = await importLegacyCollection(
			db,
			{ itinerary: itinerary(), ownerId: "u-1" },
			{ dryRun: false },
		);
		expect(again.owner).toBe("kept_owner");
		const [row] = await collectionRows();
		expect(row?.curatorId).toBe("u-otra");
		expect(row?.editorialStatus).toBe("archived");
	});

	test("si la cuenta aparece después, pasa a su nombre con el estado de origen", async () => {
		await importLegacyCollection(
			db,
			{ itinerary: itinerary(), ownerId: null },
			{ dryRun: false },
		);
		await addUser("u-1", "autora@ejemplo.test");

		const dry = await importLegacyCollection(
			db,
			{ itinerary: itinerary(), ownerId: "u-1" },
			{ dryRun: true },
		);
		expect(dry.outcome).toBe("would_update");
		expect(dry.owner).toBe("linked");
		expect((await collectionRows())[0]?.curatorId).toBe(
			LEGACY_IMPORT_SYSTEM_USER_ID,
		);

		const linked = await importLegacyCollection(
			db,
			{ itinerary: itinerary(), ownerId: "u-1" },
			{ dryRun: false },
		);
		expect(linked.outcome).toBe("updated");
		expect(linked.owner).toBe("linked");
		const [row] = await collectionRows();
		expect(row?.curatorId).toBe("u-1");
		expect(row?.editorialStatus).toBe("published");
	});
});
