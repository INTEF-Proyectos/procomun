import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { ensureLegacyImportSystemUser } from "./legacy-import/system-user.ts";
import type { DrizzleDB } from "./repository/shared.ts";
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
	getElpxResourceStatusByHash,
	getResourceById,
	getTaxonomyById,
	getUserByEmail,
	getUserById,
	importLegacyResourceWithElpx,
	listCollectionResources,
	listCollections,
	listLegacyRemoteThumbnails,
	listMediaItemsForResource,
	listResources,
	listTaxonomies,
	listUsers,
	removeResourceFromCollection,
	reorderCollectionResource,
	setResourceThumbnailUrl,
	setUserBlocked,
	softDeleteUser,
	unpublishUnreviewedLegacyResource,
	updateCollection,
	updateResource,
	updateTaxonomy,
	updateUser,
} from "./repository.ts";
import * as schema from "./schema/index.ts";
import { createTables } from "./setup.ts";

describe("repository admin helpers", () => {
	let db: DrizzleDB;
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
	let db: DrizzleDB;
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
			elpxMetadata: { title: "Test" },
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

		// Issue #466: el servido del contenido mira el estado del recurso.
		expect(await getElpxResourceStatusByHash(db, "abc123")).toEqual({
			resourceId,
			editorialStatus: "draft",
		});
		expect(await getElpxResourceStatusByHash(db, "nonexistent")).toBeNull();

		await deleteElpxProject(db, result.id);
		expect(await getElpxProjectByResourceId(db, resourceId)).toBeNull();
	});
});

describe("repository resources — otros autores (issue #417)", () => {
	let db: DrizzleDB;
	let pglite: PGlite;

	const baseInput = {
		title: "Recurso con varios autores",
		description: "Desc",
		language: "es",
		license: "cc-by",
		resourceType: "documento",
		author: "Ana Pérez",
	};

	beforeEach(async () => {
		pglite = new PGlite();
		await createTables(pglite);
		db = drizzle(pglite, { schema });
	});

	afterEach(async () => {
		await pglite.close();
	});

	test("guarda otherAuthors al crear y lo devuelve en el detalle", async () => {
		const { id } = await createResource(db, {
			...baseInput,
			otherAuthors: "Luis Gómez, Marta Ruiz",
		});
		const resource = await getResourceById(db, id);
		expect(resource?.otherAuthors).toBe("Luis Gómez, Marta Ruiz");
	});

	test("sin otherAuthors, o solo con espacios, queda a null", async () => {
		const withoutField = await createResource(db, baseInput);
		expect((await getResourceById(db, withoutField.id))?.otherAuthors).toBe(
			null,
		);
		const blank = await createResource(db, {
			...baseInput,
			otherAuthors: "  ",
		});
		expect((await getResourceById(db, blank.id))?.otherAuthors).toBe(null);
	});

	test("updateResource edita otherAuthors y lo vacía", async () => {
		const { id } = await createResource(db, baseInput);
		await updateResource(db, id, { otherAuthors: "Luis Gómez" });
		expect((await getResourceById(db, id))?.otherAuthors).toBe("Luis Gómez");
		await updateResource(db, id, { otherAuthors: "" });
		expect((await getResourceById(db, id))?.otherAuthors).toBe(null);
	});
});

describe("repository collection-resources", () => {
	let db: DrizzleDB;
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
		const item = items[0];
		expect(item).toBeDefined();
		if (!item) throw new Error("expected collection item");
		expect(item.resourceId).toBe(resourceId);
		expect(item.position).toBe(1);

		await removeResourceFromCollection(db, collectionId, resourceId);
		const after = await listCollectionResources(db, collectionId);
		expect(after).toHaveLength(0);
	});

	test("posición por defecto es 0", async () => {
		await addResourceToCollection(db, collectionId, resourceId);
		const items = await listCollectionResources(db, collectionId);
		expect(items).toHaveLength(1);
		const item = items[0];
		expect(item).toBeDefined();
		if (!item) throw new Error("expected collection item");
		expect(item.position).toBe(0);
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
		const first = items[0];
		const second = items[1];
		expect(first).toBeDefined();
		expect(second).toBeDefined();
		if (!first || !second) throw new Error("expected reordered items");
		expect(first.resourceId).toBe(secondResourceId);
		expect(second.resourceId).toBe(resourceId);
	});
});

describe("repository — gestión de usuarios (alta y baja)", () => {
	let db: DrizzleDB;
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

	async function sessionsOf(userId: string) {
		return (await db.select().from(schema.session)).filter(
			(s) => s.userId === userId,
		);
	}

	test("bloquear marca la cuenta, la banea en better-auth y cierra sus sesiones (#456)", async () => {
		await ensureUser(db, {
			id: "u-bloq",
			email: "bloq@example.com",
			name: "Bloq",
			role: "author",
		});
		await db.insert(schema.session).values({
			id: "sess-bloq",
			userId: "u-bloq",
			token: "token-bloq",
			expiresAt: new Date(Date.now() + 86_400_000),
		});

		await setUserBlocked(db, "u-bloq", true);

		const [blocked] = await db
			.select()
			.from(schema.user)
			.where(eq(schema.user.id, "u-bloq"));
		expect(blocked?.isActive).toBeFalse();
		expect(blocked?.banned).toBeTrue();
		expect(blocked?.banExpires).toBeNull();
		expect(await sessionsOf("u-bloq")).toHaveLength(0);

		await setUserBlocked(db, "u-bloq", false);
		const [unblocked] = await db
			.select()
			.from(schema.user)
			.where(eq(schema.user.id, "u-bloq"));
		expect(unblocked?.isActive).toBeTrue();
		expect(unblocked?.banned).toBeFalse();
		expect(unblocked?.banReason).toBeNull();
	});

	test("updateUser con isActive bloquea y desbloquea con el mismo mecanismo", async () => {
		await ensureUser(db, {
			id: "u-upd",
			email: "upd@example.com",
			name: "Upd",
			role: "author",
		});
		await db.insert(schema.session).values({
			id: "sess-upd",
			userId: "u-upd",
			token: "token-upd",
			expiresAt: new Date(Date.now() + 86_400_000),
		});

		await updateUser(db, "u-upd", { isActive: false });
		let [row] = await db
			.select()
			.from(schema.user)
			.where(eq(schema.user.id, "u-upd"));
		expect(row?.banned).toBeTrue();
		expect(await sessionsOf("u-upd")).toHaveLength(0);

		await updateUser(db, "u-upd", { isActive: true });
		[row] = await db
			.select()
			.from(schema.user)
			.where(eq(schema.user.id, "u-upd"));
		expect(row?.isActive).toBeTrue();
		expect(row?.banned).toBeFalse();
	});

	test("desbloquear no reactiva una cuenta dada de baja", async () => {
		await ensureUser(db, {
			id: "u-baja",
			email: "baja@example.com",
			name: "Baja",
			role: "author",
		});
		await softDeleteUser(db, "u-baja");

		await setUserBlocked(db, "u-baja", false);

		const [row] = await db
			.select()
			.from(schema.user)
			.where(eq(schema.user.id, "u-baja"));
		expect(row?.banned).toBeTrue();
		expect(row?.isActive).toBeFalse();
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
		const account = accounts[0];
		expect(account).toBeDefined();
		if (!account) throw new Error("expected credential account");
		expect(account.providerId).toBe("credential");
		expect(account.password).toBe("salt:deadbeef");
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
	let db: DrizzleDB;
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
		previewImageUrl: null,
		editorialStatus: "published" as const,
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

	test("guarda la URL preview del JSON en resources.thumbnail_url (issue #407)", async () => {
		const previewImageUrl =
			"https://ode.educacion.es/INTEF/1416349635379/vistaPreviaAgrega.png";
		const result = await importLegacyResourceWithElpx(db, {
			resource: {
				...baseResourceInput,
				externalId: "es_test_preview",
				previewImageUrl,
			},
			elpx: { ...elpxInput, hash: "hash-legacy-test-preview" },
			media: buildMediaInput(crypto.randomUUID()),
		});

		const [row] = await db
			.select({ thumbnailUrl: schema.resources.thumbnailUrl })
			.from(schema.resources)
			.where(eq(schema.resources.id, result.resourceId));
		expect(row?.thumbnailUrl).toBe(previewImageUrl);

		const listed = await listResources(db, { status: "published", limit: 20 });
		const card = listed.data.find((item) => item.id === result.resourceId);
		expect(card?.thumbnailUrl).toBe(previewImageUrl);
	});

	test("guarda las visitas históricas como valor inicial del contador (issue #421)", async () => {
		const withViews = await importLegacyResourceWithElpx(db, {
			resource: {
				...baseResourceInput,
				externalId: "es_test_visitas",
				legacyViewCount: 1532,
			},
			elpx: { ...elpxInput, hash: "hash-legacy-test-visitas" },
			media: buildMediaInput(crypto.randomUUID()),
		});
		const withoutViews = await importLegacyResourceWithElpx(db, {
			resource: { ...baseResourceInput, externalId: "es_test_sin_visitas" },
			elpx: { ...elpxInput, hash: "hash-legacy-test-sin-visitas" },
			media: buildMediaInput(crypto.randomUUID()),
		});

		const rows = await db
			.select()
			.from(schema.resourceViewCounts)
			.where(
				inArray(schema.resourceViewCounts.resourceId, [
					withViews.resourceId,
					withoutViews.resourceId,
				]),
			);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			resourceId: withViews.resourceId,
			viewCount: 0,
			legacyViewCount: 1532,
		});
	});

	test("guarda los otros autores del JSON en resources.other_authors (issue #417)", async () => {
		const result = await importLegacyResourceWithElpx(db, {
			resource: {
				...baseResourceInput,
				externalId: "es_test_otros_autores",
				otherAuthors: "Luis Gómez, Marta Ruiz",
			},
			elpx: { ...elpxInput, hash: "hash-legacy-test-otros-autores" },
			media: buildMediaInput(crypto.randomUUID()),
		});

		const [row] = await db
			.select({ otherAuthors: schema.resources.otherAuthors })
			.from(schema.resources)
			.where(eq(schema.resources.id, result.resourceId));
		expect(row?.otherAuthors).toBe("Luis Gómez, Marta Ruiz");
	});

	test("respeta el estado editorial calculado desde published (issue #447)", async () => {
		const result = await importLegacyResourceWithElpx(db, {
			resource: {
				...baseResourceInput,
				externalId: "es_test_borrador",
				editorialStatus: "draft",
			},
			elpx: { ...elpxInput, hash: "hash-legacy-test-borrador" },
			media: buildMediaInput(crypto.randomUUID()),
		});

		const [row] = await db
			.select({ editorialStatus: schema.resources.editorialStatus })
			.from(schema.resources)
			.where(eq(schema.resources.id, result.resourceId));
		expect(row?.editorialStatus).toBe("draft");
		const listed = await listResources(db, { status: "published", limit: 20 });
		expect(listed.data.some((item) => item.id === result.resourceId)).toBe(
			false,
		);
	});

	describe("unpublishUnreviewedLegacyResource (corrección de #447)", () => {
		async function importAs(externalId: string) {
			return importLegacyResourceWithElpx(db, {
				resource: { ...baseResourceInput, externalId },
				elpx: { ...elpxInput, hash: `hash-${externalId}` },
				media: buildMediaInput(crypto.randomUUID()),
			});
		}

		async function statusOf(resourceId: string) {
			const [row] = await db
				.select({ editorialStatus: schema.resources.editorialStatus })
				.from(schema.resources)
				.where(eq(schema.resources.id, resourceId));
			return row?.editorialStatus;
		}

		test("pasa a borrador un recurso publicado que nadie ha revisado; en seco no escribe", async () => {
			const { resourceId } = await importAs("es_fix_sin_revisar");

			const dry = await unpublishUnreviewedLegacyResource(
				db,
				"legacy-procomun",
				"es_fix_sin_revisar",
				{ dryRun: true },
			);
			expect(dry).toEqual({ outcome: "unpublished", resourceId });
			expect(await statusOf(resourceId)).toBe("published");

			const real = await unpublishUnreviewedLegacyResource(
				db,
				"legacy-procomun",
				"es_fix_sin_revisar",
				{ dryRun: false },
			);
			expect(real).toEqual({ outcome: "unpublished", resourceId });
			expect(await statusOf(resourceId)).toBe("draft");

			const again = await unpublishUnreviewedLegacyResource(
				db,
				"legacy-procomun",
				"es_fix_sin_revisar",
				{ dryRun: false },
			);
			expect(again).toEqual({ outcome: "not_published", resourceId });
		});

		test("no toca un recurso que un curator ya ha revisado", async () => {
			const { resourceId } = await importAs("es_fix_revisado");
			await db
				.update(schema.resources)
				.set({
					assignedCuratorId: "legacy-import-system-user",
					curatedAt: new Date(),
				})
				.where(eq(schema.resources.id, resourceId));

			const result = await unpublishUnreviewedLegacyResource(
				db,
				"legacy-procomun",
				"es_fix_revisado",
				{ dryRun: false },
			);
			expect(result).toEqual({ outcome: "reviewed", resourceId });
			expect(await statusOf(resourceId)).toBe("published");
		});

		test("no toca un recurso destacado", async () => {
			const { resourceId } = await importAs("es_fix_destacado");
			await db
				.update(schema.resources)
				.set({ featuredAt: new Date() })
				.where(eq(schema.resources.id, resourceId));

			const result = await unpublishUnreviewedLegacyResource(
				db,
				"legacy-procomun",
				"es_fix_destacado",
				{ dryRun: false },
			);
			expect(result.outcome).toBe("reviewed");
			expect(await statusOf(resourceId)).toBe("published");
		});

		test("informa de los recursos que no se importaron", async () => {
			const result = await unpublishUnreviewedLegacyResource(
				db,
				"legacy-procomun",
				"es_fix_no_existe",
				{ dryRun: false },
			);
			expect(result).toEqual({ outcome: "not_found", resourceId: null });
		});
	});

	// #409: relleno de las miniaturas legacy enlazadas en caliente.
	test("lista solo las miniaturas legacy remotas y permite sustituirlas", async () => {
		const remote = await importLegacyResourceWithElpx(db, {
			resource: {
				...baseResourceInput,
				externalId: "es_remota",
				previewImageUrl:
					"https://ode.educacion.es/INTEF/es_remota/vistaPreviaAgrega.png",
			},
			elpx: { ...elpxInput, hash: "hash-remota" },
			media: buildMediaInput(crypto.randomUUID()),
		});
		await importLegacyResourceWithElpx(db, {
			resource: {
				...baseResourceInput,
				externalId: "es_local",
				previewImageUrl: `/api/v1/thumbnails/${"a".repeat(64)}.png`,
			},
			elpx: { ...elpxInput, hash: "hash-local" },
			media: buildMediaInput(crypto.randomUUID()),
		});
		await importLegacyResourceWithElpx(db, {
			resource: { ...baseResourceInput, externalId: "es_sin_imagen" },
			elpx: { ...elpxInput, hash: "hash-sin-imagen" },
			media: buildMediaInput(crypto.randomUUID()),
		});

		expect(await listLegacyRemoteThumbnails(db, "legacy-procomun")).toEqual([
			{
				id: remote.resourceId,
				externalId: "es_remota",
				thumbnailUrl:
					"https://ode.educacion.es/INTEF/es_remota/vistaPreviaAgrega.png",
			},
		]);

		const local = `/api/v1/thumbnails/${"b".repeat(64)}.png`;
		await setResourceThumbnailUrl(db, remote.resourceId, local);

		expect(await listLegacyRemoteThumbnails(db, "legacy-procomun")).toEqual([]);
		const [row] = await db
			.select({ thumbnailUrl: schema.resources.thumbnailUrl })
			.from(schema.resources)
			.where(eq(schema.resources.id, remote.resourceId));
		expect(row?.thumbnailUrl).toBe(local);
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
