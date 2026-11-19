import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import {
	ensureLegacyImportSystemUser,
	LEGACY_IMPORT_SYSTEM_USER_EMAIL,
	LEGACY_IMPORT_SYSTEM_USER_ID,
} from "../legacy-import/system-user.ts";
import * as schema from "../schema/index.ts";
import { createTables } from "../setup.ts";
import {
	findLegacyAccountById,
	findLegacyAuthorAccount,
	linkLegacyResourceAuthor,
} from "./legacy-authors.ts";
import { importLegacyResourceWithElpx } from "./legacy-import.ts";
import type { DrizzleDB } from "./shared.ts";
import { ensureUser, softDeleteUser } from "./users.ts";

// #456: los recursos importados pasan a la cuenta cuyo correo coincide con
// `publicatorEmailStr`. Sin cuenta siguen a nombre del sistema.
describe("autoría de los recursos legacy (issue #456)", () => {
	let pglite: PGlite;
	let db: DrizzleDB;

	beforeEach(async () => {
		pglite = new PGlite();
		await createTables(pglite);
		db = drizzle(pglite, { schema });
		await ensureLegacyImportSystemUser(db);
	});

	afterEach(async () => {
		await pglite.close();
	});

	/** Inserta tal cual, sin pasar por ensureUser (que normaliza el correo). */
	async function insertUser(id: string, email: string, emailVerified = true) {
		await db.insert(schema.user).values({
			id,
			email,
			emailVerified,
			role: "author",
			createdAt: new Date(),
			updatedAt: new Date(),
		});
	}

	async function importAs(externalId: string, createdBy?: string | null) {
		const uploadId = crypto.randomUUID();
		return importLegacyResourceWithElpx(db, {
			resource: {
				externalId,
				importSource: "legacy-procomun",
				sourceUri: null,
				title: `Recurso ${externalId}`,
				description: "Descripción",
				language: "es",
				license: "cc-by",
				resourceType: "documento",
				subjects: [],
				levels: [],
				author: "Autora en texto",
				publisher: "Publicadora en texto",
				keywords: null,
				importedAt: null,
				previewImageUrl: null,
				editorialStatus: "draft",
				...(createdBy === undefined ? {} : { createdBy }),
			},
			elpx: {
				hash: `hash-${externalId}`,
				extractPath: `/tmp/legacy-authors/${externalId}`,
				originalFilename: `${externalId}.elpx`,
				hasPreview: false,
				elpxMetadata: null,
			},
			media: {
				uploadId,
				ownerId: LEGACY_IMPORT_SYSTEM_USER_ID,
				fileSize: 1,
				mimeType: "application/zip",
				url: `/api/v1/uploads/${uploadId}/content`,
				storageKey: `legacy-import/${uploadId}/${externalId}.elpx`,
				finalChecksum: null,
			},
		});
	}

	async function resourceRow(resourceId: string) {
		const [row] = await db
			.select({
				createdBy: schema.resources.createdBy,
				author: schema.resources.author,
				publisher: schema.resources.publisher,
				updatedAt: schema.resources.updatedAt,
			})
			.from(schema.resources)
			.where(eq(schema.resources.id, resourceId));
		return row;
	}

	describe("findLegacyAuthorAccount", () => {
		test("encuentra la cuenta sin distinguir mayúsculas ni espacios", async () => {
			await insertUser("autora-1", "Autora.Uno@Ejemplo.test");

			expect(
				await findLegacyAuthorAccount(db, "  AUTORA.uno@ejemplo.TEST "),
			).toEqual({ id: "autora-1", deleted: false, emailVerified: true });
		});

		test("devuelve null si ninguna cuenta tiene ese correo", async () => {
			await insertUser("autora-1", "autora.uno@ejemplo.test");

			expect(await findLegacyAuthorAccount(db, "otra@ejemplo.test")).toBeNull();
			expect(await findLegacyAuthorAccount(db, "   ")).toBeNull();
		});

		test("marca las cuentas dadas de baja", async () => {
			await insertUser("autora-baja", "baja@ejemplo.test");
			await softDeleteUser(db, "autora-baja");

			expect(await findLegacyAuthorAccount(db, "baja@ejemplo.test")).toEqual({
				id: "autora-baja",
				deleted: true,
				emailVerified: true,
			});
		});

		test("marca las cuentas sin el correo verificado", async () => {
			// Con AUTH_REQUIRE_EMAIL_VERIFICATION=false cualquiera puede darse de
			// alta con el correo de un autor antiguo: no basta con que coincida.
			await insertUser("sin-verificar", "autora@ejemplo.test", false);

			expect(await findLegacyAuthorAccount(db, "autora@ejemplo.test")).toEqual({
				id: "sin-verificar",
				deleted: false,
				emailVerified: false,
			});
		});

		test("nunca devuelve el usuario de sistema del importador", async () => {
			expect(
				await findLegacyAuthorAccount(db, LEGACY_IMPORT_SYSTEM_USER_EMAIL),
			).toBeNull();
		});
	});

	describe("importLegacyResourceWithElpx con creador", () => {
		test("guarda la cuenta del autor como creador sin tocar el autor en texto", async () => {
			await ensureUser(db, { id: "autora-1", email: "autora@ejemplo.test" });

			const { resourceId } = await importAs("es_con_cuenta", "autora-1");

			expect(await resourceRow(resourceId)).toMatchObject({
				createdBy: "autora-1",
				author: "Autora en texto",
				publisher: "Publicadora en texto",
			});
		});

		test("sin cuenta deja el creador vacío, como hasta ahora", async () => {
			const { resourceId } = await importAs("es_sin_cuenta");

			expect((await resourceRow(resourceId))?.createdBy).toBeNull();
		});
	});

	describe("linkLegacyResourceAuthor", () => {
		beforeEach(async () => {
			await ensureUser(db, { id: "autora-1", email: "autora@ejemplo.test" });
		});

		test("en seco no escribe; después enlaza y repetirlo no cambia nada", async () => {
			const { resourceId } = await importAs("es_enlazar");
			const before = await resourceRow(resourceId);

			const dry = await linkLegacyResourceAuthor(db, resourceId, "autora-1", {
				dryRun: true,
			});
			expect(dry).toEqual({ outcome: "linked" });
			expect((await resourceRow(resourceId))?.createdBy).toBeNull();

			const real = await linkLegacyResourceAuthor(db, resourceId, "autora-1", {
				dryRun: false,
			});
			expect(real).toEqual({ outcome: "linked" });
			const after = await resourceRow(resourceId);
			expect(after).toMatchObject({
				createdBy: "autora-1",
				author: "Autora en texto",
				publisher: "Publicadora en texto",
			});
			// Cambiar de dueño no es editar el recurso: no sube en «Mis recursos».
			expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());

			const again = await linkLegacyResourceAuthor(db, resourceId, "autora-1", {
				dryRun: false,
			});
			expect(again).toEqual({ outcome: "already_linked" });
		});

		test("también enlaza un recurso a nombre del usuario de sistema", async () => {
			const { resourceId } = await importAs(
				"es_sistema",
				LEGACY_IMPORT_SYSTEM_USER_ID,
			);

			const result = await linkLegacyResourceAuthor(
				db,
				resourceId,
				"autora-1",
				{ dryRun: false },
			);

			expect(result).toEqual({ outcome: "linked" });
			expect((await resourceRow(resourceId))?.createdBy).toBe("autora-1");
		});

		test("nunca pisa a un creador real", async () => {
			await ensureUser(db, { id: "editora", email: "editora@ejemplo.test" });
			const { resourceId } = await importAs("es_reasignado", "editora");

			for (const dryRun of [true, false]) {
				const result = await linkLegacyResourceAuthor(
					db,
					resourceId,
					"autora-1",
					{ dryRun },
				);
				expect(result).toEqual({
					outcome: "kept_creator",
					createdBy: "editora",
				});
			}
			expect((await resourceRow(resourceId))?.createdBy).toBe("editora");
		});

		test("informa si el recurso no existe", async () => {
			expect(
				await linkLegacyResourceAuthor(db, "no-existe", "autora-1", {
					dryRun: false,
				}),
			).toEqual({ outcome: "not_found" });
		});
	});

	test("findLegacyAccountById busca por id aunque el correo haya cambiado (#552)", async () => {
		await insertUser(
			"legacy-procomun:user:7",
			"nuevo-correo@ejemplo.test",
			false,
		);
		expect(await findLegacyAccountById(db, "legacy-procomun:user:7")).toEqual({
			id: "legacy-procomun:user:7",
			deleted: false,
			emailVerified: false,
		});
		expect(
			await findLegacyAccountById(db, "legacy-procomun:user:8"),
		).toBeNull();
		expect(
			await findLegacyAccountById(db, LEGACY_IMPORT_SYSTEM_USER_ID),
		).toBeNull();
	});
});
