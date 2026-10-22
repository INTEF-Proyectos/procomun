import { beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../schema/index.ts";
import { resourceVersions } from "../schema/versions.ts";
import { createTables } from "../setup.ts";
import {
	createElpxProject,
	deleteElpxProject,
	getCurrentElpxProjectByResourceId,
} from "./elpx-projects.ts";
import {
	isElpxHashHistorical,
	isUploadSessionOfCurrentVersion,
	listResourceVersions,
	publishResourceVersion,
	restoreResourceVersion,
} from "./resource-versions.ts";
import {
	createResource,
	getResourceById,
	updateResource,
} from "./resources.ts";
import type { DrizzleDB } from "./shared.ts";
import { listResourceTags, syncTagsFromKeywords } from "./tags.ts";
import { createUploadSession } from "./uploads.ts";

let db: DrizzleDB;

async function seedUser(id: string) {
	await db.insert(schema.user).values({
		id,
		email: `${id}@example.test`,
		name: `Usuaria ${id}`,
	});
}

async function seedResource(title = "Recurso versionable") {
	const { id } = await createResource(db, {
		title,
		description: "Descripción inicial",
		language: "es",
		license: "cc-by",
		resourceType: "documento",
		author: "Ana Autora",
		publisher: "INTEF",
		subjects: ["Física"],
		levels: ["Secundaria"],
		createdBy: "autora",
	});
	return id;
}

async function seedProject(resourceId: string, hash: string) {
	return createElpxProject(db, {
		resourceId,
		hash,
		extractPath: `/data/elpx/${hash}`,
		originalFilename: `recurso-${hash.slice(0, 6)}.elpx`,
	});
}

beforeAll(async () => {
	const pglite = new PGlite();
	await createTables(pglite);
	db = drizzle(pglite, { schema }) as unknown as DrizzleDB;
	await seedUser("autora");
	await seedUser("curadora");
});

describe("resource versions", () => {
	test("creates consecutive immutable versions and advances current_version_id", async () => {
		const resourceId = await seedResource();
		const project1 = await seedProject(resourceId, "a".repeat(64));
		const v1 = await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: project1.id,
			createdBy: "autora",
		});
		const project2 = await seedProject(resourceId, "b".repeat(64));
		const v2 = await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: project2.id,
			createdBy: "autora",
		});

		expect(v1.versionNumber).toBe(1);
		expect(v2.versionNumber).toBe(2);
		const history = await listResourceVersions(db, resourceId);
		expect(history).toHaveLength(2);
		expect(history[0]?.id).toBe(v2.id);
		expect(history[0]?.isCurrent).toBe(true);
		expect(history[1]?.id).toBe(v1.id);
		expect("changeNotes" in (history[0] ?? {})).toBe(false);

		const [resource] = await db
			.select({ currentVersionId: schema.resources.currentVersionId })
			.from(schema.resources)
			.where(eq(schema.resources.id, resourceId))
			.limit(1);
		expect(resource?.currentVersionId).toBe(v2.id);
	});

	test("captures the current metadata snapshot", async () => {
		const resourceId = await seedResource("Título snapshot");
		const project = await seedProject(resourceId, "c".repeat(64));
		await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: project.id,
			createdBy: "autora",
		});

		const [version] = await db
			.select()
			.from(resourceVersions)
			.where(eq(resourceVersions.resourceId, resourceId));
		const snapshot = version?.metadataSnapshot as Record<string, unknown>;
		expect(snapshot.title).toBe("Título snapshot");
		expect(snapshot.description).toBe("Descripción inicial");
		expect(snapshot.subjects).toEqual(["Física"]);
		expect(snapshot.levels).toEqual(["Secundaria"]);
		expect(version?.fileSha256).toBe("c".repeat(64));
	});

	test("restores without mutating history", async () => {
		const resourceId = await seedResource("Título v1");
		const project1 = await seedProject(resourceId, "d".repeat(64));
		const v1 = await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: project1.id,
			createdBy: "autora",
		});

		await db
			.update(schema.resources)
			.set({ title: "Título v2" })
			.where(eq(schema.resources.id, resourceId));
		const project2 = await seedProject(resourceId, "e".repeat(64));
		await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: project2.id,
			createdBy: "autora",
		});

		const restored = await restoreResourceVersion(db, {
			resourceId,
			versionId: v1.id,
			createdBy: "curadora",
		});
		expect(restored.versionNumber).toBe(3);
		expect(restored.restoredFromVersionNumber).toBe(1);

		const history = await listResourceVersions(db, resourceId);
		expect(history).toHaveLength(3);
		expect(history[0]?.elpxProjectId).toBe(project1.id);
		expect(history[2]?.id).toBe(v1.id);
		const resource = await getResourceById(db, resourceId);
		expect(resource?.title).toBe("Título v1");
	});

	test("guarda la categorización educativa en el snapshot y la restaura", async () => {
		const resourceId = await seedResource("Recurso clasificado");
		const v1Areas = [
			{ categoryId: "educacion-primaria", optionId: "primer-ciclo" },
			{ categoryId: "bachillerato", optionId: null },
		];
		await updateResource(db, resourceId, { educationalAreas: v1Areas });
		const project1 = await seedProject(resourceId, "p".repeat(64));
		const v1 = await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: project1.id,
			createdBy: "autora",
		});
		const [version] = await db
			.select()
			.from(resourceVersions)
			.where(eq(resourceVersions.id, v1.id));
		expect(version?.metadataSnapshot).toMatchObject({
			educationalAreas: v1Areas,
		});

		await updateResource(db, resourceId, {
			educationalAreas: [{ categoryId: "ele", optionId: "avanzado" }],
		});
		const project2 = await seedProject(resourceId, "q".repeat(64));
		await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: project2.id,
			createdBy: "autora",
		});

		await restoreResourceVersion(db, {
			resourceId,
			versionId: v1.id,
			createdBy: "curadora",
		});
		expect((await getResourceById(db, resourceId))?.educationalAreas).toEqual(
			v1Areas,
		);
	});

	test("un snapshot anterior a la categorización conserva la actual", async () => {
		const resourceId = await seedResource("Recurso con versión antigua");
		const project = await seedProject(resourceId, "r".repeat(64));
		const v1 = await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: project.id,
			createdBy: "autora",
		});
		const [version] = await db
			.select()
			.from(resourceVersions)
			.where(eq(resourceVersions.id, v1.id));
		const { educationalAreas: _, ...legacySnapshot } =
			(version?.metadataSnapshot ?? {}) as Record<string, unknown>;
		await db
			.update(resourceVersions)
			.set({ metadataSnapshot: legacySnapshot })
			.where(eq(resourceVersions.id, v1.id));
		const current = [{ categoryId: "formacion-profesorado", optionId: null }];
		await updateResource(db, resourceId, { educationalAreas: current });

		await restoreResourceVersion(db, {
			resourceId,
			versionId: v1.id,
			createdBy: "curadora",
		});
		expect((await getResourceById(db, resourceId))?.educationalAreas).toEqual(
			current,
		);
	});

	test("guarda «Otros autores» en el snapshot y lo restaura (issue #417)", async () => {
		const resourceId = await seedResource("Recurso con varios autores");
		await updateResource(db, resourceId, { otherAuthors: "Luis Gómez" });
		const project1 = await seedProject(resourceId, "s".repeat(64));
		const v1 = await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: project1.id,
			createdBy: "autora",
		});

		await updateResource(db, resourceId, { otherAuthors: "Marta Ruiz" });
		const project2 = await seedProject(resourceId, "t".repeat(64));
		await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: project2.id,
			createdBy: "autora",
		});

		await restoreResourceVersion(db, {
			resourceId,
			versionId: v1.id,
			createdBy: "curadora",
		});
		expect((await getResourceById(db, resourceId))?.otherAuthors).toBe(
			"Luis Gómez",
		);
	});

	test("un snapshot anterior a «Otros autores» conserva el valor actual", async () => {
		const resourceId = await seedResource("Recurso con snapshot antiguo");
		const project = await seedProject(resourceId, "u".repeat(64));
		const v1 = await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: project.id,
			createdBy: "autora",
		});
		const [version] = await db
			.select()
			.from(resourceVersions)
			.where(eq(resourceVersions.id, v1.id));
		const { otherAuthors: _, ...legacySnapshot } = (version?.metadataSnapshot ??
			{}) as Record<string, unknown>;
		await db
			.update(resourceVersions)
			.set({ metadataSnapshot: legacySnapshot })
			.where(eq(resourceVersions.id, v1.id));
		await updateResource(db, resourceId, { otherAuthors: "Marta Ruiz" });

		await restoreResourceVersion(db, {
			resourceId,
			versionId: v1.id,
			createdBy: "curadora",
		});
		expect((await getResourceById(db, resourceId))?.otherAuthors).toBe(
			"Marta Ruiz",
		);
	});

	test("clears newer tags when the restored snapshot has no keywords", async () => {
		const resourceId = await seedResource("Recurso sin etiquetas");
		const project1 = await seedProject(resourceId, "g".repeat(64));
		const v1 = await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: project1.id,
			createdBy: "autora",
		});

		await syncTagsFromKeywords(db, resourceId, "geometría");
		const project2 = await seedProject(resourceId, "h".repeat(64));
		await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: project2.id,
			createdBy: "autora",
		});
		expect(await listResourceTags(db, resourceId)).toHaveLength(1);

		await restoreResourceVersion(db, {
			resourceId,
			versionId: v1.id,
			createdBy: "curadora",
		});

		expect(await listResourceTags(db, resourceId)).toHaveLength(0);
		const restored = await getResourceById(db, resourceId);
		expect(restored?.keywords).toBeNull();
	});

	test("prevents deleting an ELPX referenced by history", async () => {
		const resourceId = await seedResource();
		const project = await seedProject(resourceId, "f".repeat(64));
		await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: project.id,
			createdBy: "autora",
		});
		await expect(deleteElpxProject(db, project.id)).rejects.toThrow();
	});

	test("resolves the ELPX from the current version", async () => {
		const resourceId = await seedResource();
		const project1 = await seedProject(resourceId, "1".repeat(64));
		await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: project1.id,
			createdBy: "autora",
		});
		const project2 = await seedProject(resourceId, "2".repeat(64));
		await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: project2.id,
			createdBy: "autora",
		});
		const current = await getCurrentElpxProjectByResourceId(db, resourceId);
		expect(current?.id).toBe(project2.id);
	});

	test("marks only the current-version upload and hash as public", async () => {
		const resourceId = await seedResource();
		const historicalUploadId = `hist-${crypto.randomUUID()}`;
		const currentUploadId = `curr-${crypto.randomUUID()}`;
		await createUploadSession(db, {
			id: historicalUploadId,
			resourceId,
			ownerId: "autora",
			originalFilename: "v1.elpx",
			storageKey: `resource/${resourceId}/${historicalUploadId}/v1.elpx`,
		});
		await createUploadSession(db, {
			id: currentUploadId,
			resourceId,
			ownerId: "autora",
			originalFilename: "v2.elpx",
			storageKey: `resource/${resourceId}/${currentUploadId}/v2.elpx`,
		});

		const historicalHash = "i".repeat(64);
		const currentHash = "j".repeat(64);
		const project1 = await createElpxProject(db, {
			resourceId,
			hash: historicalHash,
			extractPath: `/data/elpx/${historicalHash}`,
			originalFilename: "v1.elpx",
			uploadSessionId: historicalUploadId,
		});
		await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: project1.id,
			createdBy: "autora",
		});
		const project2 = await createElpxProject(db, {
			resourceId,
			hash: currentHash,
			extractPath: `/data/elpx/${currentHash}`,
			originalFilename: "v2.elpx",
			uploadSessionId: currentUploadId,
		});
		await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: project2.id,
			createdBy: "autora",
		});

		expect(await isUploadSessionOfCurrentVersion(db, historicalUploadId)).toBe(
			false,
		);
		expect(await isUploadSessionOfCurrentVersion(db, currentUploadId)).toBe(
			true,
		);
		expect(await isElpxHashHistorical(db, historicalHash)).toBe(true);
		expect(await isElpxHashHistorical(db, currentHash)).toBe(false);
		expect(await isElpxHashHistorical(db, "k".repeat(64))).toBe(false);
	});

	test("restoring a version makes its hash and upload current again", async () => {
		const resourceId = await seedResource();
		const firstUploadId = `rest-${crypto.randomUUID()}`;
		await createUploadSession(db, {
			id: firstUploadId,
			resourceId,
			ownerId: "autora",
			originalFilename: "v1.elpx",
			storageKey: `resource/${resourceId}/${firstUploadId}/v1.elpx`,
		});
		const firstHash = "m".repeat(64);
		const laterHash = "n".repeat(64);
		const project1 = await createElpxProject(db, {
			resourceId,
			hash: firstHash,
			extractPath: `/data/elpx/${firstHash}`,
			originalFilename: "v1.elpx",
			uploadSessionId: firstUploadId,
		});
		const v1 = await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: project1.id,
			createdBy: "autora",
		});
		const project2 = await seedProject(resourceId, laterHash);
		await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: project2.id,
			createdBy: "autora",
		});

		expect(await isElpxHashHistorical(db, firstHash)).toBe(true);
		expect(await isUploadSessionOfCurrentVersion(db, firstUploadId)).toBe(
			false,
		);

		await restoreResourceVersion(db, {
			resourceId,
			versionId: v1.id,
			createdBy: "curadora",
		});

		expect(await isElpxHashHistorical(db, firstHash)).toBe(false);
		expect(await isElpxHashHistorical(db, laterHash)).toBe(true);
		expect(await isUploadSessionOfCurrentVersion(db, firstUploadId)).toBe(true);
	});
});
