import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { ensureLegacyImportSystemUser } from "./legacy-import/system-user.ts";
import {
	addResourceToCollection,
	createCollection,
	createElpxProject,
	createResource,
	createTaxonomy,
	createUserWithCredentials,
	deleteCollection,
	deleteElpxProject,
	deleteTaxonomy,
	ensureUser,
	findLegacyResourceByExternalId,
	getCollectionById,
	getCollectionBySlug,
	getElpxProjectByHash,
	getElpxProjectByResourceId,
	getTaxonomyById,
	getUserByEmail,
	getUserById,
	importLegacyResourceWithElpx,
	listCollectionResources,
	listCollections,
	listMediaItemsForResource,
	listTaxonomies,
	listUsers,
	removeResourceFromCollection,
	reorderCollectionResource,
	softDeleteUser,
	updateCollection,
	updateTaxonomy,
	updateUser,
} from "./repository.ts";
import * as schema from "./schema/index.ts";
import { createTables } from "./setup.ts";

describe("repository admin helpers", () => {
	let db: ReturnType<typeof drizzle>;
	let pglite: PGlite;

	beforeEach(async () => {
		pglite = new PGlite();
		await createTables(pglite);
		db = drizzle(pglite, { schema });
	});

	afterEach(async () => {
		await pglite.close();
	});

	test("crea y actualiza usuarios sin duplicarlos", async () => {
		const created = await ensureUser(db, {
			id: "user-admin",
			email: "admin@example.com",
			name: "Admin Inicial",
			role: "admin",
		});

		expect(created?.email).toBe("admin@example.com");
		expect(created?.role).toBe("admin");

		const sameUser = await ensureUser(db, {
			id: "user-admin",
			email: "otro@example.com",
			name: "No debe cambiar",
			role: "editor",
		});
		expect(sameUser?.email).toBe("admin@example.com");

		await ensureUser(db, {
			id: "user-editor",
			email: "editor@example.com",
			name: "Editor",
			role: "editor",
		});
		await updateUser(db, "user-editor", {
			name: "Editor Jefe",
			isActive: false,
		});

		const updated = await getUserById(db, "user-editor");
		expect(updated?.name).toBe("Editor Jefe");
		expect(updated?.isActive).toBe(false);

		const list = await listUsers(db, {
			search: "editor",
			role: "editor",
			isActive: false,
		});
		expect(list.total).toBe(1);
		expect(list.data[0]?.id).toBe("user-editor");
	});

	test("gestiona colecciones con filtros de búsqueda y curatorId", async () => {
		await ensureUser(db, {
			id: "curator-1",
			email: "curator@example.com",
			name: "Curadora",
			role: "editor",
		});
		await ensureUser(db, {
			id: "curator-2",
			email: "owner@example.com",
			name: "Otra Curadora",
			role: "editor",
		});

		const first = await createCollection(db, {
			title: "Álgebra visual",
			description: "Colección de matemáticas",
			coverImageUrl: "https://img.example/algebra.png",
			curatorId: "curator-1",
		});
		await createCollection(db, {
			title: "Historia universal",
			description: "Colección de sociales",
			curatorId: "curator-2",
			editorialStatus: "published",
			isOrdered: true,
		});

		const filtered = await listCollections(db, {
			search: "algebra",
			curatorId: "curator-1",
		});
		expect(filtered.total).toBe(1);
		expect(filtered.data[0]?.slug).toContain("algebra-visual-");
		expect(filtered.data[0]?.coverImageUrl).toBe(
			"https://img.example/algebra.png",
		);

		await updateCollection(db, first.id, {
			title: "Álgebra visual avanzada",
			coverImageUrl: "https://img.example/algebra-2.png",
			editorialStatus: "published",
			isOrdered: true,
		});

		const updated = await getCollectionById(db, first.id);
		expect(updated?.title).toBe("Álgebra visual avanzada");
		expect(updated?.coverImageUrl).toBe("https://img.example/algebra-2.png");
		expect(updated?.editorialStatus).toBe("published");
		expect(updated?.isOrdered).toBe(true);
		expect(updated).not.toBeNull();
		if (!updated) return; // la aserción previa ya ha fallado el test; solo estrecha el tipo

		const bySlug = await getCollectionBySlug(db, updated.slug, {
			status: "published",
		});
		expect(bySlug?.id).toBe(first.id);

		await deleteCollection(db, first.id);
		expect(await getCollectionById(db, first.id)).toBeNull();
	});

	test("gestiona taxonomías con slug normalizado, filtro por tipo y borrado", async () => {
		const parent = await createTaxonomy(db, {
			name: "Educación Primaria",
			type: "level",
		});
		const child = await createTaxonomy(db, {
			name: "Matemáticas",
			type: "subject",
			parentId: parent.id,
		});

		const levels = await listTaxonomies(db, {
			search: "educacion",
			type: "level",
		});
		expect(levels.total).toBe(1);
		expect(levels.data[0]?.slug).toContain("educacion-primaria-");

		await updateTaxonomy(db, child.id, {
			name: "Matemáticas Aplicadas",
			slug: "matematicas-aplicadas",
			type: "topic",
			parentId: null,
		});

		const updated = await getTaxonomyById(db, child.id);
		expect(updated?.name).toBe("Matemáticas Aplicadas");
		expect(updated?.slug).toBe("matematicas-aplicadas");
		expect(updated?.type).toBe("topic");
		expect(updated?.parentId).toBeNull();

		await deleteTaxonomy(db, child.id);
		expect(await getTaxonomyById(db, child.id)).toBeNull();
	});

	test("no permite crear taxonomías duplicadas con mismo nombre y tipo", async () => {
		await createTaxonomy(db, { name: "Ciencias", type: "subject" });

		await expect(
			createTaxonomy(db, { name: "Ciencias", type: "subject" }),
		).rejects.toThrow(
			"Ya existe una taxonomía con el nombre «Ciencias» y tipo «subject»",
		);
	});

	test("permite crear taxonomías con mismo nombre pero distinto tipo", async () => {
		await createTaxonomy(db, { name: "General", type: "subject" });
		const second = await createTaxonomy(db, { name: "General", type: "level" });
		expect(second.id).toBeTruthy();
	});
});

describe("repository elpx projects", () => {
	let db: ReturnType<typeof drizzle>;
	let pglite: PGlite;

	let resourceId: string;

	beforeEach(async () => {
		pglite = new PGlite();
		await createTables(pglite);
		db = drizzle(pglite, { schema });
		await ensureUser(db, {
			id: "u1",
			email: "a@b.com",
			name: "A",
			role: "admin",
		});
		const res = await createResource(db, {
			title: "Recurso",
			description: "Desc",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			createdBy: "u1",
		});
		resourceId = res.id;
	});

	afterEach(async () => {
		await pglite.close();
	});

	test("crea, consulta por resource y por hash, y borra", async () => {
		const result = await createElpxProject(db, {
			resourceId,
			hash: "abc123",
			extractPath: "/tmp/test",
			originalFilename: "test.elpx",
			hasPreview: true,
			elpxMetadata: JSON.stringify({ title: "Test" }),
		});
		expect(result.id).toBeTruthy();

		const byResource = await getElpxProjectByResourceId(db, resourceId);
		expect(byResource).not.toBeNull();
		expect(byResource?.hash).toBe("abc123");
		expect(byResource?.originalFilename).toBe("test.elpx");

		const byHash = await getElpxProjectByHash(db, "abc123");
		expect(byHash).not.toBeNull();
		expect(byHash?.resourceId).toBe(resourceId);

		const notFound = await getElpxProjectByHash(db, "nonexistent");
		expect(notFound).toBeNull();

		await deleteElpxProject(db, result.id);
		expect(await getElpxProjectByResourceId(db, resourceId)).toBeNull();
	});
});

describe("repository collection-resources", () => {
	let db: ReturnType<typeof drizzle>;
	let pglite: PGlite;
	let collectionId: string;
	let resourceId: string;
	let secondResourceId: string;

	beforeEach(async () => {
		pglite = new PGlite();
		await createTables(pglite);
		db = drizzle(pglite, { schema });
		await ensureUser(db, {
			id: "u1",
			email: "a@b.com",
			name: "A",
			role: "admin",
		});

		const col = await createCollection(db, {
			title: "Col",
			description: "D",
			curatorId: "u1",
		});
		collectionId = col.id;

		const res = await createResource(db, {
			title: "Recurso",
			description: "Desc",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			createdBy: "u1",
		});
		resourceId = res.id;

		const res2 = await createResource(db, {
			title: "Recurso dos",
			description: "Desc 2",
			language: "es",
			license: "cc-by",
			resourceType: "video",
			createdBy: "u1",
		});
		secondResourceId = res2.id;
	});

	afterEach(async () => {
		await pglite.close();
	});

	test("añade, lista y elimina recurso de colección", async () => {
		await addResourceToCollection(db, collectionId, resourceId, 1);

		const items = await listCollectionResources(db, collectionId);
		expect(items).toHaveLength(1);
		expect(items[0].resourceId).toBe(resourceId);
		expect(items[0].position).toBe(1);

		await removeResourceFromCollection(db, collectionId, resourceId);
		const after = await listCollectionResources(db, collectionId);
		expect(after).toHaveLength(0);
	});

	test("posición por defecto es 0", async () => {
		await addResourceToCollection(db, collectionId, resourceId);
		const items = await listCollectionResources(db, collectionId);
		expect(items).toHaveLength(1);
		expect(items[0].position).toBe(0);
	});

	test("reordena recursos intercambiando posiciones", async () => {
		await addResourceToCollection(db, collectionId, resourceId, 0);
		await addResourceToCollection(db, collectionId, secondResourceId, 1);

		const reordered = await reorderCollectionResource(
			db,
			collectionId,
			secondResourceId,
			"up",
		);
		expect(reordered).toBe(true);

		const items = await listCollectionResources(db, collectionId);
		expect(items[0].resourceId).toBe(secondResourceId);
		expect(items[1].resourceId).toBe(resourceId);
	});
});

describe("repository — gestión de usuarios (alta y baja)", () => {
	let db: ReturnType<typeof drizzle>;
	let pglite: PGlite;

	beforeEach(async () => {
		pglite = new PGlite();
		await createTables(pglite);
		db = drizzle(pglite, { schema });
	});

	afterEach(async () => {
		await pglite.close();
	});

	test("getUserByEmail localiza por correo o devuelve null", async () => {
		await ensureUser(db, {
			id: "u-email",
			email: "find@example.com",
			name: "Find",
			role: "author",
		});

		const found = await getUserByEmail(db, "find@example.com");
		expect(found?.id).toBe("u-email");

		const missing = await getUserByEmail(db, "nope@example.com");
		expect(missing).toBeNull();
	});

	test("updateUser persiste el campo bio y getUserById lo devuelve (DEF-004 / #201)", async () => {
		await ensureUser(db, {
			id: "u-bio",
			email: "bio@example.com",
			name: "Bio User",
			role: "author",
		});

		await updateUser(db, "u-bio", {
			name: "Bio Editada",
			bio: "Profesora de matemáticas",
		});

		const updated = await getUserById(db, "u-bio");
		expect(updated?.name).toBe("Bio Editada");
		expect(updated?.bio).toBe("Profesora de matemáticas");

		// El listado de administración también debe exponer la bio.
		const list = await listUsers(db, { id: "u-bio" });
		expect(list.data[0]?.bio).toBe("Profesora de matemáticas");
	});

	test("createUserWithCredentials crea el usuario y su cuenta de credenciales", async () => {
		const created = await createUserWithCredentials(db, {
			email: "nuevo@example.com",
			name: "Nuevo Usuario",
			role: "editor",
			passwordHash: "salt:deadbeef",
		});

		expect(created?.email).toBe("nuevo@example.com");
		expect(created?.role).toBe("editor");
		expect(created?.id).toBeTruthy();
		expect(created).not.toBeNull();
		if (!created) return; // la aserción previa ya ha fallado el test; solo estrecha el tipo

		// Aparece en el listado de administración
		const list = await listUsers(db, {});
		expect(list.data.some((u) => u.email === "nuevo@example.com")).toBe(true);

		// Se guarda una cuenta "credential" con el hash de contraseña
		const accounts = (await db.select().from(schema.account)).filter(
			(a) => a.userId === created.id,
		);
		expect(accounts).toHaveLength(1);
		expect(accounts[0].providerId).toBe("credential");
		expect(accounts[0].password).toBe("salt:deadbeef");
	});

	test("softDeleteUser elimina al usuario del listado y revoca sus sesiones", async () => {
		await ensureUser(db, {
			id: "u-del",
			email: "del@example.com",
			name: "Del",
			role: "author",
		});
		// Sesión activa que debe revocarse al dar de baja (DEF-020)
		await db.insert(schema.session).values({
			id: "sess-del",
			userId: "u-del",
			token: "token-del",
			expiresAt: new Date(Date.now() + 86_400_000),
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		const before = await listUsers(db, {});
		expect(before.data.some((u) => u.id === "u-del")).toBe(true);

		await softDeleteUser(db, "u-del");

		const after = await listUsers(db, {});
		expect(after.data.some((u) => u.id === "u-del")).toBe(false);
		expect(after.total).toBe(before.total - 1);

		// Un usuario dado de baja ya no es consultable (getUserById lo excluye)
		const stillThere = await getUserById(db, "u-del");
		expect(stillThere).toBeNull();

		// Las sesiones activas quedan revocadas
		const sessions = (await db.select().from(schema.session)).filter(
			(s) => s.userId === "u-del",
		);
		expect(sessions).toHaveLength(0);
	});
});

describe("legacy import repository (epic-004-migracion-legacy-procomun)", () => {
	let db: ReturnType<typeof drizzle>;
	let pglite: PGlite;

	const baseResourceInput = {
		externalId: "es_test_9999999",
		importSource: "legacy-procomun",
		sourceUri: "https://ode.educacion.es/INTEF/es_test_9999999",
		title: "Recurso de prueba legacy",
		description: "Descripción de prueba",
		language: "es",
		license: "cc-by-sa",
		resourceType: "proyecto",
		subjects: ["Matemáticas"],
		levels: ["Educación Secundaria Obligatoria"],
		author: "Autora de prueba",
		publisher: "Editorial de prueba",
		keywords: "geometria,areas",
		importedAt: new Date("2024-05-22T20:07:51.000Z"),
	};

	function buildMediaInput(uploadId: string) {
		return {
			uploadId,
			ownerId: "legacy-import-system-user",
			fileSize: 12345,
			mimeType: "application/zip",
			url: `/api/v1/uploads/${uploadId}/content`,
			storageKey: `resource/legacy/${uploadId}/recurso.elpx`,
			finalChecksum: "deadbeef",
		};
	}

	const elpxInput = {
		hash: "hash-legacy-test-0001",
		extractPath: "/tmp/legacy-import-test/hash-legacy-test-0001",
		originalFilename: "recurso.elpx",
		hasPreview: true,
		elpxMetadata: { title: "Recurso de prueba legacy" },
	};

	beforeEach(async () => {
		pglite = new PGlite();
		await createTables(pglite);
		db = drizzle(pglite, { schema });
		await ensureUser(db, {
			id: "legacy-import-system-user",
			email: "legacy-import@system.local",
			role: "admin",
		});
	});

	afterEach(async () => {
		await pglite.close();
	});

	test("findLegacyResourceByExternalId devuelve null cuando no existe", async () => {
		const found = await findLegacyResourceByExternalId(
			db,
			"legacy-procomun",
			"no-existe",
		);
		expect(found).toBeNull();
	});

	test("importLegacyResourceWithElpx persiste resource + subjects + levels + elpx_project + media_item + upload_session", async () => {
		const uploadId = crypto.randomUUID();
		const result = await importLegacyResourceWithElpx(db, {
			resource: baseResourceInput,
			elpx: elpxInput,
			media: buildMediaInput(uploadId),
		});

		expect(result.resourceId).toBeTruthy();
		expect(result.slug).toContain("recurso-de-prueba-legacy");

		const found = await findLegacyResourceByExternalId(
			db,
			"legacy-procomun",
			baseResourceInput.externalId,
		);
		expect(found?.id).toBe(result.resourceId);

		// Los recursos legacy ya estaban publicados en origen: se importan
		// directamente como "published", no como "draft" (ver ADR-0029).
		// createdAt debe usar la fecha de origen (importedAt), no el instante de
		// ejecución del import, para no desplazar el orden del catálogo público
		// (listResources ordena por createdAt DESC).
		const [resourceRow] = await db
			.select({
				editorialStatus: schema.resources.editorialStatus,
				createdAt: schema.resources.createdAt,
			})
			.from(schema.resources)
			.where(eq(schema.resources.id, result.resourceId));
		expect(resourceRow?.editorialStatus).toBe("published");
		expect(resourceRow?.createdAt?.toISOString()).toBe(
			baseResourceInput.importedAt.toISOString(),
		);

		const elpxProject = await getElpxProjectByResourceId(db, result.resourceId);
		expect(elpxProject?.hash).toBe(elpxInput.hash);
		expect(elpxProject?.hasPreview).toBe(true);

		const media = await listMediaItemsForResource(db, result.resourceId);
		expect(media).toHaveLength(1);
		expect(media[0]?.filename).toBe("recurso.elpx");
		expect(media[0]?.isPrimary).toBe(true);

		const subjects = await db
			.select()
			.from(schema.resourceSubjects)
			.where(eq(schema.resourceSubjects.resourceId, result.resourceId));
		expect(subjects.map((s) => s.subject)).toEqual(["Matemáticas"]);
	});

	test("re-ejecutar sobre el mismo externalId no duplica (idempotencia vía índice único)", async () => {
		const firstUploadId = crypto.randomUUID();
		await importLegacyResourceWithElpx(db, {
			resource: baseResourceInput,
			elpx: elpxInput,
			media: buildMediaInput(firstUploadId),
		});

		const existing = await findLegacyResourceByExternalId(
			db,
			"legacy-procomun",
			baseResourceInput.externalId,
		);
		expect(existing).not.toBeNull();

		// El orquestador CLI comprueba findLegacyResourceByExternalId antes de
		// llamar a importLegacyResourceWithElpx; si se ignora esa comprobación,
		// el índice único de BD debe seguir impidiendo el duplicado.
		await expect(
			importLegacyResourceWithElpx(db, {
				resource: baseResourceInput,
				elpx: { ...elpxInput, hash: "hash-legacy-test-0002" },
				media: buildMediaInput(crypto.randomUUID()),
			}),
		).rejects.toThrow();

		const all = await db
			.select()
			.from(schema.resources)
			.where(eq(schema.resources.externalId, baseResourceInput.externalId));
		expect(all).toHaveLength(1);
	});

	test("un .elpx con el mismo hash bajo otro externalId falla por la unicidad de elpx_projects.hash", async () => {
		await importLegacyResourceWithElpx(db, {
			resource: baseResourceInput,
			elpx: elpxInput,
			media: buildMediaInput(crypto.randomUUID()),
		});

		await expect(
			importLegacyResourceWithElpx(db, {
				resource: { ...baseResourceInput, externalId: "es_test_otro_id" },
				elpx: elpxInput, // mismo hash
				media: buildMediaInput(crypto.randomUUID()),
			}),
		).rejects.toThrow();
	});

	test("ensureLegacyImportSystemUser puede usarse como ownerId real de upload_sessions", async () => {
		const systemUser = await ensureLegacyImportSystemUser(db);
		expect(systemUser?.id).toBeTruthy();
		expect(systemUser).not.toBeNull();
		if (!systemUser) return; // la aserción previa ya ha fallado el test; solo estrecha el tipo

		const uploadId = crypto.randomUUID();
		const result = await importLegacyResourceWithElpx(db, {
			resource: { ...baseResourceInput, externalId: "es_test_system_user" },
			elpx: { ...elpxInput, hash: "hash-legacy-test-system-user" },
			media: { ...buildMediaInput(uploadId), ownerId: systemUser.id },
		});

		const sessions = await db
			.select()
			.from(schema.uploadSessions)
			.where(eq(schema.uploadSessions.resourceId, result.resourceId));
		expect(sessions[0]?.ownerId).toBe(systemUser.id);
		expect(sessions[0]?.status).toBe("completed");
	});

	test("createdAt cae al instante de ejecución cuando no se pudo resolver una fecha de origen", async () => {
		const before = new Date();
		const result = await importLegacyResourceWithElpx(db, {
			resource: {
				...baseResourceInput,
				externalId: "es_test_sin_fecha",
				importedAt: null,
			},
			elpx: { ...elpxInput, hash: "hash-legacy-test-sin-fecha" },
			media: buildMediaInput(crypto.randomUUID()),
		});

		const [resourceRow] = await db
			.select({ createdAt: schema.resources.createdAt })
			.from(schema.resources)
			.where(eq(schema.resources.id, result.resourceId));
		expect(resourceRow?.createdAt).not.toBeNull();
		expect(resourceRow?.createdAt.getTime()).toBeGreaterThanOrEqual(
			before.getTime(),
		);
	});
});
