import { beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../schema/index.ts";
import { createTables } from "../setup.ts";
import { getPublicAuthor } from "./public-authors.ts";
import { createResource } from "./resources.ts";
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

async function seedResource(createdBy: string) {
	return createResource(db, {
		title: `Recurso de ${createdBy}`,
		description: "Descripción",
		language: "es",
		license: "cc-by",
		resourceType: "documento",
		createdBy,
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
});
