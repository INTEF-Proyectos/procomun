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
	getElpxProjectByResourceId,
} from "./elpx-projects.ts";
import {
	countVersionsReferencingElpxProject,
	isUploadSessionReferencedByVersions,
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
	return id;
}

async function seedResource(overrides: { title?: string } = {}) {
	const { id } = await createResource(db, {
		title: overrides.title ?? "Recurso versionable",
		description: "Descripción inicial",
		language: "es",
		license: "cc-by",
		resourceType: "documento",
		keywords: "energía, ciencia",
		author: "Ana Autora",
		publisher: "INTEF",
		subjects: ["Física"],
		levels: ["Secundaria"],
		createdBy: "autora",
	});
	return id;
}

async function seedElpxProject(resourceId: string, hash: string) {
	const { id } = await createElpxProject(db, {
		resourceId,
		hash,
		extractPath: `/data/elpx/${hash}`,
		originalFilename: `recurso-${hash.slice(0, 6)}.elpx`,
	});
	return id;
}

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

beforeAll(async () => {
	const pglite = new PGlite();
	await createTables(pglite);
	db = drizzle(pglite, { schema }) as unknown as DrizzleDB;
	await seedUser("autora");
	await seedUser("curadora");
});

describe("resource_versions — publicación (issue #31 / RF-001..RF-005)", () => {
	test("publicar la primera versión crea v1 y actualiza current_version_id", async () => {
		const resourceId = await seedResource();
		const projectId = await seedElpxProject(resourceId, HASH_A);

		const version = await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: projectId,
			changeNotes: "Primera entrega",
			createdBy: "autora",
		});

		expect(version.versionNumber).toBe(1);

		const rows = await db
			.select()
			.from(schema.resources)
			.where(eq(schema.resources.id, resourceId));
		expect(rows[0]?.currentVersionId).toBe(version.id);
	});

	test("publicar una segunda versión incrementa el número y conserva la anterior", async () => {
		const resourceId = await seedResource();
		const firstProject = await seedElpxProject(resourceId, HASH_B);
		const first = await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: firstProject,
			createdBy: "autora",
		});

		const secondProject = await seedElpxProject(resourceId, "c".repeat(64));
		const second = await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: secondProject,
			changeNotes: "Corrige erratas",
			createdBy: "autora",
		});

		expect(second.versionNumber).toBe(2);

		const history = await listResourceVersions(db, resourceId);
		expect(history).toHaveLength(2);
		expect(history[0]?.versionNumber).toBe(2);
		expect(history[0]?.isCurrent).toBe(true);
		expect(history[1]?.versionNumber).toBe(1);
		expect(history[1]?.isCurrent).toBe(false);
		expect(history[1]?.id).toBe(first.id);
	});

	test("la versión captura un snapshot de los metadatos vigentes", async () => {
		const resourceId = await seedResource({ title: "Título snapshot" });
		const projectId = await seedElpxProject(resourceId, "d".repeat(64));

		await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: projectId,
			createdBy: "autora",
		});

		const [version] = await db
			.select()
			.from(resourceVersions)
			.where(eq(resourceVersions.resourceId, resourceId));
		const snapshot = version?.metadataSnapshot as Record<string, unknown>;
		expect(snapshot.title).toBe("Título snapshot");
		expect(snapshot.description).toBe("Descripción inicial");
		expect(snapshot.license).toBe("cc-by");
		expect(snapshot.language).toBe("es");
		expect(snapshot.resourceType).toBe("documento");
		expect(snapshot.author).toBe("Ana Autora");
		expect(snapshot.publisher).toBe("INTEF");
		// keywords se compara con la proyección real (la sincronización de tags
		// puede normalizar separadores al crear el recurso)
		const [projected] = await db
			.select({ keywords: schema.resources.keywords })
			.from(schema.resources)
			.where(eq(schema.resources.id, resourceId));
		expect(snapshot.keywords).toBe(projected?.keywords ?? null);
		expect(snapshot.subjects).toEqual(["Física"]);
		expect(snapshot.levels).toEqual(["Secundaria"]);
		expect(version?.fileSha256).toBe("d".repeat(64));
	});

	test("historial: autor, fecha y notas quedan registrados (RF-004)", async () => {
		const resourceId = await seedResource();
		const projectId = await seedElpxProject(resourceId, "e".repeat(64));
		await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: projectId,
			changeNotes: "Notas de cambio",
			createdBy: "autora",
		});

		const history = await listResourceVersions(db, resourceId);
		expect(history[0]?.changeNotes).toBe("Notas de cambio");
		expect(history[0]?.createdBy).toBe("autora");
		expect(history[0]?.createdByName).toBe("Usuaria autora");
		expect(history[0]?.createdAt).toBeInstanceOf(Date);
	});

	test("rechaza publicar con un proyecto elpx de otro recurso", async () => {
		const resourceId = await seedResource();
		const otherResourceId = await seedResource();
		const foreignProject = await seedElpxProject(
			otherResourceId,
			"f".repeat(64),
		);

		await expect(
			publishResourceVersion(db, {
				resourceId,
				elpxProjectId: foreignProject,
				createdBy: "autora",
			}),
		).rejects.toThrow();
	});

	test("dos publicaciones concurrentes obtienen números distintos y consecutivos", async () => {
		const resourceId = await seedResource();
		const projectA = await seedElpxProject(resourceId, "1".repeat(64));
		const projectB = await seedElpxProject(resourceId, "2".repeat(64));

		const [first, second] = await Promise.all([
			publishResourceVersion(db, {
				resourceId,
				elpxProjectId: projectA,
				createdBy: "autora",
			}),
			publishResourceVersion(db, {
				resourceId,
				elpxProjectId: projectB,
				createdBy: "autora",
			}),
		]);

		const numbers = [first.versionNumber, second.versionNumber].sort();
		expect(numbers).toEqual([1, 2]);
	});
});

describe("resource_versions — restauración no destructiva (RF-007)", () => {
	test("restaurar crea una versión nueva que reutiliza el archivo y el snapshot", async () => {
		const resourceId = await seedResource({ title: "Título v1" });
		const projectV1 = await seedElpxProject(resourceId, "3".repeat(64));
		const v1 = await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: projectV1,
			createdBy: "autora",
		});

		// Simula edición de metadatos + nueva entrega
		await db
			.update(schema.resources)
			.set({ title: "Título v2" })
			.where(eq(schema.resources.id, resourceId));
		const projectV2 = await seedElpxProject(resourceId, "4".repeat(64));
		await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: projectV2,
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
		expect(history[0]?.versionNumber).toBe(3);
		expect(history[0]?.isCurrent).toBe(true);
		expect(history[0]?.changeNotes).toBe("Restaurada desde la versión 1");
		expect(history[0]?.elpxProjectId).toBe(projectV1);
		expect(history[0]?.createdBy).toBe("curadora");

		// El historial previo permanece intacto (append-only)
		expect(history[2]?.id).toBe(v1.id);
		expect(history[2]?.changeNotes).toBeNull();
	});

	test("restaurar aplica el snapshot a la proyección de resources", async () => {
		const resourceId = await seedResource({ title: "Original" });
		const projectV1 = await seedElpxProject(resourceId, "5".repeat(64));
		const v1 = await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: projectV1,
			createdBy: "autora",
		});

		await db
			.update(schema.resources)
			.set({ title: "Cambiado", description: "Otra descripción" })
			.where(eq(schema.resources.id, resourceId));
		const projectV2 = await seedElpxProject(resourceId, "6".repeat(64));
		await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: projectV2,
			createdBy: "autora",
		});

		await restoreResourceVersion(db, {
			resourceId,
			versionId: v1.id,
			createdBy: "curadora",
		});

		const resource = await getResourceById(db, resourceId);
		expect(resource?.title).toBe("Original");
		expect(resource?.description).toBe("Descripción inicial");
		expect(resource?.subjects).toEqual(["Física"]);
		expect(resource?.levels).toEqual(["Secundaria"]);
	});

	test("rechaza restaurar una versión de otro recurso", async () => {
		const resourceId = await seedResource();
		const otherId = await seedResource();
		const project = await seedElpxProject(otherId, "7".repeat(64));
		const foreignVersion = await publishResourceVersion(db, {
			resourceId: otherId,
			elpxProjectId: project,
			createdBy: "autora",
		});

		await expect(
			restoreResourceVersion(db, {
				resourceId,
				versionId: foreignVersion.id,
				createdBy: "curadora",
			}),
		).rejects.toThrow();
	});
});

describe("resource_versions — invariantes de esquema", () => {
	test("un recurso admite varios proyectos elpx (unique eliminado)", async () => {
		const resourceId = await seedResource();
		await seedElpxProject(resourceId, "8".repeat(64));
		await seedElpxProject(resourceId, "9".repeat(64));

		const rows = await db
			.select()
			.from(schema.elpxProjects)
			.where(eq(schema.elpxProjects.resourceId, resourceId));
		expect(rows).toHaveLength(2);
	});

	test("UNIQUE(resource_id, version_number) impide duplicados", async () => {
		const resourceId = await seedResource();
		const projectId = await seedElpxProject(resourceId, "0".repeat(64));
		await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: projectId,
			createdBy: "autora",
		});

		await expect(
			(async () => {
				await db.insert(resourceVersions).values({
					id: crypto.randomUUID(),
					resourceId,
					versionNumber: 1,
					elpxProjectId: projectId,
					fileSha256: "0".repeat(64),
					metadataSnapshot: {},
				});
			})(),
		).rejects.toThrow();
	});

	test("no se puede borrar un elpx_project referenciado por una versión", async () => {
		const resourceId = await seedResource();
		const projectId = await seedElpxProject(resourceId, "ab".repeat(32));
		await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: projectId,
			createdBy: "autora",
		});

		await expect(deleteElpxProject(db, projectId)).rejects.toThrow();
	});
});

describe("resolución del proyecto elpx (vigente vs. copia de trabajo)", () => {
	test("getCurrentElpxProjectByResourceId devuelve el proyecto de la versión vigente", async () => {
		const resourceId = await seedResource();
		const projectV1 = await seedElpxProject(resourceId, "cd".repeat(32));
		const v1 = await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: projectV1,
			createdBy: "autora",
		});
		const projectV2 = await seedElpxProject(resourceId, "ef".repeat(32));
		await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: projectV2,
			createdBy: "autora",
		});

		const current = await getCurrentElpxProjectByResourceId(db, resourceId);
		expect(current?.id).toBe(projectV2);

		await restoreResourceVersion(db, {
			resourceId,
			versionId: v1.id,
			createdBy: "curadora",
		});
		const afterRestore = await getCurrentElpxProjectByResourceId(
			db,
			resourceId,
		);
		expect(afterRestore?.id).toBe(projectV1);
	});

	test("la versión vigente no cambia aunque se suba una nueva copia de trabajo", async () => {
		const resourceId = await seedResource();
		const published = await seedElpxProject(resourceId, "c3".repeat(32));
		await db
			.update(schema.elpxProjects)
			.set({ createdAt: new Date(Date.now() - 60_000) })
			.where(eq(schema.elpxProjects.id, published));
		await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: published,
			createdBy: "autora",
		});

		// Nueva subida sin publicar: copia de trabajo del autor
		const draft = await seedElpxProject(resourceId, "d4".repeat(32));

		const current = await getCurrentElpxProjectByResourceId(db, resourceId);
		expect(current?.id).toBe(published);

		const workingCopy = await getElpxProjectByResourceId(db, resourceId);
		expect(workingCopy?.id).toBe(draft);
	});

	test("sin versiones publicadas ambas resoluciones devuelven el proyecto más reciente", async () => {
		const resourceId = await seedResource();
		const older = await seedElpxProject(resourceId, "a1".repeat(32));
		await db
			.update(schema.elpxProjects)
			.set({ createdAt: new Date(Date.now() - 60_000) })
			.where(eq(schema.elpxProjects.id, older));
		const newer = await seedElpxProject(resourceId, "b2".repeat(32));

		const latest = await getElpxProjectByResourceId(db, resourceId);
		expect(latest?.id).toBe(newer);
		const current = await getCurrentElpxProjectByResourceId(db, resourceId);
		expect(current?.id).toBe(newer);
	});
});

describe("resource_versions — referencias de protección", () => {
	test("countVersionsReferencingElpxProject distingue publicados de borradores", async () => {
		const resourceId = await seedResource();
		const published = await seedElpxProject(resourceId, "e1".repeat(32));
		const draft = await seedElpxProject(resourceId, "e2".repeat(32));
		await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: published,
			createdBy: "autora",
		});

		expect(await countVersionsReferencingElpxProject(db, published)).toBe(1);
		expect(await countVersionsReferencingElpxProject(db, draft)).toBe(0);
	});

	test("isUploadSessionReferencedByVersions detecta sesiones del historial", async () => {
		const resourceId = await seedResource();
		const sessionId = crypto.randomUUID();
		await db.insert(schema.uploadSessions).values({
			id: sessionId,
			resourceId,
			ownerId: "autora",
			status: "completed",
			originalFilename: "recurso.elpx",
			storageKey: sessionId,
			finalChecksum: "e3".repeat(32),
		});
		const { id: projectId } = await createElpxProject(db, {
			resourceId,
			hash: crypto.randomUUID(),
			extractPath: "/data/elpx/ref-session",
			originalFilename: "recurso.elpx",
			uploadSessionId: sessionId,
		});

		expect(await isUploadSessionReferencedByVersions(db, sessionId)).toBe(
			false,
		);

		await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: projectId,
			createdBy: "autora",
		});

		expect(await isUploadSessionReferencedByVersions(db, sessionId)).toBe(true);
		expect(
			await isUploadSessionReferencedByVersions(db, crypto.randomUUID()),
		).toBe(false);
	});
});

describe("resource_versions — checksum de la entrega", () => {
	test("prefiere upload_sessions.finalChecksum sobre elpx_projects.hash", async () => {
		const resourceId = await seedResource();
		const sessionId = crypto.randomUUID();
		await db.insert(schema.uploadSessions).values({
			id: sessionId,
			resourceId,
			ownerId: "autora",
			status: "completed",
			originalFilename: "recurso.elpx",
			storageKey: sessionId,
			checksumAlgorithm: "sha256",
			finalChecksum: "9".repeat(64),
		});
		// hash aleatorio (UUID) como en el flujo real de subida
		const { id: projectId } = await createElpxProject(db, {
			resourceId,
			hash: crypto.randomUUID(),
			extractPath: "/data/elpx/uuid",
			originalFilename: "recurso.elpx",
			uploadSessionId: sessionId,
		});

		const version = await publishResourceVersion(db, {
			resourceId,
			elpxProjectId: projectId,
			createdBy: "autora",
		});

		const [row] = await db
			.select()
			.from(resourceVersions)
			.where(eq(resourceVersions.id, version.id));
		expect(row?.fileSha256).toBe("9".repeat(64));
	});
});
