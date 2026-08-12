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
	listResourceVersions,
	publishResourceVersion,
	restoreResourceVersion,
} from "./resource-versions.ts";
import { createResource, getResourceById } from "./resources.ts";
import type { DrizzleDB } from "./shared.ts";

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
});
