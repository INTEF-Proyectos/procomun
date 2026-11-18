import { beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../schema/index.ts";
import { createTables } from "../setup.ts";
import {
	addResourceToCollection,
	listCollectionResources,
} from "./collection-resources.ts";
import { createCollection } from "./collections.ts";
import { getPublicAuthor } from "./public-authors.ts";
import {
	createResource,
	deleteResource,
	getResourceBySlug,
	listResources,
} from "./resources.ts";
import type { DrizzleDB } from "./shared.ts";

let db: DrizzleDB;

async function seedUser(
	id: string,
	extra: Partial<typeof schema.user.$inferInsert> = {},
) {
	await db.insert(schema.user).values({
		id,
		email: `${id}@example.test`,
		name: `Usuaria ${id}`,
		...extra,
	});
}

async function seedResource(
	createdBy: string,
	editorialStatus: "draft" | "review" | "published" | "archived" = "published",
) {
	return createResource(db, {
		title: `Recurso de ${createdBy}`,
		description: "Descripción",
		language: "es",
		license: "cc-by",
		resourceType: "documento",
		createdBy,
		editorialStatus,
	});
}

beforeAll(async () => {
	const pglite = new PGlite();
	await createTables(pglite);
	db = drizzle(pglite, { schema }) as unknown as DrizzleDB;
	await seedUser("publicadora", { image: "https://example.test/foto.png" });
	await seedResource("publicadora");
	await seedUser("lectora");
	await seedUser("baja");
	await seedResource("baja");
	await db
		.update(schema.user)
		.set({ deletedAt: new Date() })
		.where(eq(schema.user.id, "baja"));

	// Revisión de #487: la ficha solo existe si la cuenta tiene algún recurso
	// publicado y no eliminado. Borradores, revisiones, archivados o eliminados
	// no bastan.
	await seedUser("solo-borradores");
	await seedResource("solo-borradores", "draft");
	await seedResource("solo-borradores", "draft");
	await seedUser("solo-eliminados");
	const deleted = await seedResource("solo-eliminados", "published");
	await deleteResource(db, deleted.id);
	await seedUser("revision-y-archivo");
	await seedResource("revision-y-archivo", "review");
	await seedResource("revision-y-archivo", "archived");
	await seedUser("una-publicada");
	await seedResource("una-publicada", "published");
	await seedResource("una-publicada", "draft");
	await seedResource("una-publicada", "review");
});

describe("ficha pública de quien publica (#458)", () => {
	test("devuelve solo nombre, foto e id, sin correo ni rol", async () => {
		const author = await getPublicAuthor(db, "publicadora");
		expect(author).toEqual({
			id: "publicadora",
			name: "Usuaria publicadora",
			image: "https://example.test/foto.png",
		});
	});

	test("no expone cuentas que nunca han creado un recurso", async () => {
		expect(await getPublicAuthor(db, "lectora")).toBeNull();
	});

	test("no expone cuentas dadas de baja", async () => {
		expect(await getPublicAuthor(db, "baja")).toBeNull();
	});

	test("devuelve null para un id desconocido", async () => {
		expect(await getPublicAuthor(db, "no-existe")).toBeNull();
	});

	test("no expone cuentas con solo borradores", async () => {
		expect(await getPublicAuthor(db, "solo-borradores")).toBeNull();
	});

	test("no expone cuentas con solo recursos eliminados", async () => {
		expect(await getPublicAuthor(db, "solo-eliminados")).toBeNull();
	});

	test("no expone cuentas con solo recursos en revisión o archivados", async () => {
		expect(await getPublicAuthor(db, "revision-y-archivo")).toBeNull();
	});

	test("con un publicado y borradores existe y cuenta solo el publicado", async () => {
		expect(await getPublicAuthor(db, "una-publicada")).toEqual({
			id: "una-publicada",
			name: "Usuaria una-publicada",
			image: null,
		});
		const listed = await listResources(db, {
			createdBy: "una-publicada",
			status: "published",
		});
		expect(listed.total).toBe(1);
		expect(listed.data).toHaveLength(1);
	});
});

describe("cuenta creadora activa o dada de baja (#541)", () => {
	test("listResources indica si la cuenta creadora sigue activa", async () => {
		const active = await listResources(db, { createdBy: "publicadora" });
		const gone = await listResources(db, { createdBy: "baja" });
		expect(active.data.map((r) => r.createdByActive)).toEqual([true]);
		expect(gone.data.map((r) => r.createdByActive)).toEqual([false]);
	});

	test("getResourceBySlug indica si la cuenta creadora sigue activa", async () => {
		const [active] = (await listResources(db, { createdBy: "publicadora" }))
			.data;
		const [gone] = (await listResources(db, { createdBy: "baja" })).data;
		if (!active || !gone) throw new Error("faltan los recursos de la semilla");
		expect((await getResourceBySlug(db, active.slug))?.createdByActive).toBe(
			true,
		);
		expect((await getResourceBySlug(db, gone.slug))?.createdByActive).toBe(
			false,
		);
	});

	test("un recurso sin cuenta creadora no tiene cuenta activa", async () => {
		const orphan = await createResource(db, {
			title: "Recurso importado sin cuenta",
			description: "Descripción",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			editorialStatus: "published",
		});
		const found = await getResourceBySlug(db, orphan.slug);
		expect(found?.createdBy).toBeNull();
		expect(found?.createdByActive).toBe(false);
		await deleteResource(db, orphan.id);
	});

	test("listCollectionResources indica si la cuenta creadora sigue activa", async () => {
		const collection = await createCollection(db, {
			title: "Colección con una baja",
			description: "D",
			curatorId: "publicadora",
		});
		const [active] = (await listResources(db, { createdBy: "publicadora" }))
			.data;
		const [gone] = (await listResources(db, { createdBy: "baja" })).data;
		if (!active || !gone) throw new Error("faltan los recursos de la semilla");
		await addResourceToCollection(db, collection.id, active.id, 1);
		await addResourceToCollection(db, collection.id, gone.id, 2);
		const items = await listCollectionResources(db, collection.id);
		expect(items.map((item) => [item.createdBy, item.createdByActive])).toEqual(
			[
				["publicadora", true],
				["baja", false],
			],
		);
	});
});
