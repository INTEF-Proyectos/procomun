import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import {
	ensureUser,
	importLegacyResourceWithElpx,
	markLegacyResourceCertified,
	updateResource,
} from "../repository.ts";
import * as schema from "../schema/index.ts";
import { activityEvents } from "../schema/social.ts";
import { createTables } from "../setup.ts";
import type { DrizzleDB } from "./shared.ts";

// Issue #420: los importados con `certified` activo llevan el sello
// «Validado» (validation_source = 'legacy', sin validated_by).

const SYSTEM_USER = "legacy-import-system-user";

function legacyInput(
	externalId: string,
	opts: { certified?: boolean; editorialStatus?: "published" | "draft" } = {},
) {
	return {
		resource: {
			externalId,
			importSource: "legacy-procomun",
			sourceUri: null,
			title: "Recurso legacy",
			description: "Descripción",
			language: "es",
			license: "cc-by",
			resourceType: "proyecto",
			subjects: [],
			levels: [],
			author: null,
			publisher: null,
			keywords: null,
			previewImageUrl: null,
			importedAt: new Date("2020-01-02T00:00:00.000Z"),
			editorialStatus: opts.editorialStatus ?? ("published" as const),
			certified: opts.certified,
		},
		elpx: {
			hash: `hash-${externalId}`,
			extractPath: `/tmp/${externalId}`,
			originalFilename: "recurso.elpx",
			hasPreview: false,
			elpxMetadata: null,
		},
		media: {
			uploadId: crypto.randomUUID(),
			ownerId: SYSTEM_USER,
			fileSize: 10,
			mimeType: "application/zip",
			url: "/api/v1/uploads/x/content",
			storageKey: `legacy/${externalId}`,
			finalChecksum: `sum-${externalId}`,
		},
	};
}

describe("sello de los importados con certified (#420)", () => {
	let db: DrizzleDB;
	let pglite: PGlite;

	beforeEach(async () => {
		pglite = new PGlite();
		await createTables(pglite);
		db = drizzle(pglite, { schema });
		await ensureUser(db, {
			id: SYSTEM_USER,
			email: "legacy-import@system.local",
			role: "admin",
		});
	});

	afterEach(async () => {
		await pglite.close();
	});

	async function row(id: string) {
		const [resource] = await db
			.select()
			.from(schema.resources)
			.where(eq(schema.resources.id, id));
		return resource;
	}

	describe("al importar", () => {
		test("un certificado publicado entra con el sello legacy", async () => {
			const { resourceId } = await importLegacyResourceWithElpx(
				db,
				legacyInput("cert-pub", { certified: true }),
			);

			const resource = await row(resourceId);
			expect(resource?.validatedAt).toBeInstanceOf(Date);
			expect(resource?.validationSource).toBe("legacy");
			expect(resource?.validatedBy).toBeNull();
		});

		test("un certificado que entra como borrador no lo lleva", async () => {
			const { resourceId } = await importLegacyResourceWithElpx(
				db,
				legacyInput("cert-draft", {
					certified: true,
					editorialStatus: "draft",
				}),
			);

			expect((await row(resourceId))?.validatedAt).toBeNull();
		});

		test("uno sin certified no lo lleva", async () => {
			const { resourceId } = await importLegacyResourceWithElpx(
				db,
				legacyInput("sin-cert"),
			);

			expect((await row(resourceId))?.validatedAt).toBeNull();
		});
	});

	describe("markLegacyResourceCertified (lo ya importado)", () => {
		async function imported(
			externalId: string,
			editorialStatus: "published" | "draft" = "published",
		) {
			return (
				await importLegacyResourceWithElpx(
					db,
					legacyInput(externalId, { editorialStatus }),
				)
			).resourceId;
		}

		test("marca un publicado sin sello ni cambios", async () => {
			const id = await imported("m1");

			const result = await markLegacyResourceCertified(
				db,
				"legacy-procomun",
				"m1",
				{ dryRun: false },
			);

			expect(result).toEqual({ outcome: "marked", resourceId: id });
			expect((await row(id))?.validationSource).toBe("legacy");
		});

		test("en seco no escribe nada", async () => {
			const id = await imported("m2");

			const result = await markLegacyResourceCertified(
				db,
				"legacy-procomun",
				"m2",
				{ dryRun: true },
			);

			expect(result.outcome).toBe("marked");
			expect((await row(id))?.validatedAt).toBeNull();
		});

		test("repetirlo no cambia nada", async () => {
			const id = await imported("m3");
			await markLegacyResourceCertified(db, "legacy-procomun", "m3", {
				dryRun: false,
			});
			const first = (await row(id))?.validatedAt;

			const again = await markLegacyResourceCertified(
				db,
				"legacy-procomun",
				"m3",
				{ dryRun: false },
			);

			expect(again).toEqual({ outcome: "already_validated", resourceId: id });
			expect((await row(id))?.validatedAt?.getTime()).toBe(first?.getTime());
		});

		test("no marca un borrador", async () => {
			const id = await imported("m4", "draft");

			const result = await markLegacyResourceCertified(
				db,
				"legacy-procomun",
				"m4",
				{ dryRun: false },
			);

			expect(result).toEqual({ outcome: "not_published", resourceId: id });
			expect((await row(id))?.validatedAt).toBeNull();
		});

		test("no marca uno editado después de importarlo", async () => {
			const id = await imported("m5");
			await updateResource(db, id, { title: "Editado tras importar" });
			await db.insert(activityEvents).values({
				id: crypto.randomUUID(),
				userId: SYSTEM_USER,
				type: "resource_updated",
				resourceId: id,
				description: "Actualizaste el recurso",
			});

			const result = await markLegacyResourceCertified(
				db,
				"legacy-procomun",
				"m5",
				{ dryRun: false },
			);

			expect(result).toEqual({ outcome: "edited", resourceId: id });
			expect((await row(id))?.validatedAt).toBeNull();
		});

		test("no encuentra lo que no se importó", async () => {
			expect(
				await markLegacyResourceCertified(db, "legacy-procomun", "nada", {
					dryRun: false,
				}),
			).toEqual({ outcome: "not_found", resourceId: null });
		});
	});
});
