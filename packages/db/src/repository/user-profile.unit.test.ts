import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../schema/index.ts";
import { createTables } from "../setup.ts";
import { EMPTY_PROFILE_DETAILS } from "../user-profile.ts";
import type { DrizzleDB } from "./shared.ts";
import {
	getUserAbout,
	getUserProfileDetails,
	saveUserAbout,
	saveUserProfileDetails,
} from "./user-profile.ts";
import {
	getUserById,
	listUsers,
	updateOwnProfile,
	updateUser,
} from "./users.ts";

describe("perfil ampliado (#533)", () => {
	let pglite: PGlite;
	let db: DrizzleDB;

	beforeEach(async () => {
		pglite = new PGlite();
		await createTables(pglite);
		db = drizzle(pglite, { schema });
		await db
			.insert(schema.user)
			.values({ id: "u1", email: "u1@example.test", role: "reader" });
	});

	afterEach(async () => {
		await pglite.close();
	});

	test("sin fila devuelve todos los campos vacíos", async () => {
		expect(await getUserProfileDetails(db, "u1")).toEqual(
			EMPTY_PROFILE_DETAILS,
		);
	});

	test("crea la fila y después solo cambia los campos que llegan", async () => {
		await saveUserProfileDetails(db, "u1", {
			locality: "Burgos",
			educationalCenter: "CEIP Ejemplo",
		});
		await saveUserProfileDetails(db, "u1", {
			locality: null,
			twitter: "@ana",
		});

		expect(await getUserProfileDetails(db, "u1")).toEqual({
			...EMPTY_PROFILE_DETAILS,
			educationalCenter: "CEIP Ejemplo",
			twitter: "@ana",
		});
		expect(await db.select().from(schema.userProfile)).toHaveLength(1);
	});

	test("el «Sobre mí» va a user_profile.about y lo devuelve getUserById", async () => {
		await updateUser(db, "u1", { name: "Ana", bio: "Docente" });
		await saveUserProfileDetails(db, "u1", { locality: "Burgos" });

		const [row] = await db.select().from(schema.userProfile);
		expect(row).toMatchObject({ about: "Docente", locality: "Burgos" });
		expect(await getUserById(db, "u1")).toMatchObject({
			name: "Ana",
			bio: "Docente",
		});
		// Los datos ampliados no incluyen el «Sobre mí».
		expect(await getUserProfileDetails(db, "u1")).not.toHaveProperty("about");

		await saveUserAbout(db, "u1", null);
		expect((await getUserById(db, "u1"))?.bio).toBeNull();
		expect((await listUsers(db, { id: "u1" })).total).toBe(1);
	});

	test("la administración no ve el «Sobre mí» que solo viene de la importación; su dueño sí", async () => {
		// Como lo deja el importador de usuarios (#488): fila sin editar.
		await db
			.insert(schema.userProfile)
			.values({ userId: "u1", about: "Importado", locality: "Soria" });

		expect((await getUserById(db, "u1"))?.bio).toBeNull();
		expect((await listUsers(db, { id: "u1" })).data[0]?.bio).toBeNull();
		expect(await getUserAbout(db, "u1")).toBe("Importado");

		// En cuanto se edita en la plataforma nueva, lo ve como antes de #533.
		await updateUser(db, "u1", { bio: "Escrito aquí" });
		expect((await getUserById(db, "u1"))?.bio).toBe("Escrito aquí");
	});

	test("updateOwnProfile guarda nombre, «Sobre mí» y datos ampliados en una transacción", async () => {
		await updateOwnProfile(db, "u1", {
			name: "Ana",
			bio: "Antes",
			profile: { locality: "Burgos" },
		});

		// Fuerza el fallo de la última escritura: country_code es VARCHAR(2).
		await expect(
			updateOwnProfile(db, "u1", {
				name: "Otra",
				bio: "Después",
				profile: { locality: "Soria", countryCode: "XYZ" },
			}),
		).rejects.toThrow();

		expect((await getUserById(db, "u1"))?.name).toBe("Ana");
		expect(await getUserAbout(db, "u1")).toBe("Antes");
		expect((await getUserProfileDetails(db, "u1")).locality).toBe("Burgos");
	});

	test("sin campos no crea una fila vacía", async () => {
		await saveUserProfileDetails(db, "u1", {});
		expect(await db.select().from(schema.userProfile)).toHaveLength(0);
	});
});
