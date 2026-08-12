import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { user } from "../schema/auth.ts";
import { elpxProjects } from "../schema/elpx.ts";
import {
	resourceLevels,
	resourceSubjects,
	resources,
} from "../schema/resources.ts";
import { uploadSessions } from "../schema/uploads.ts";
import { resourceVersions } from "../schema/versions.ts";
import type { DrizzleDB } from "./shared.ts";

/** Snapshot de metadatos capturado al crear cada versión (issue #31). */
export type ResourceVersionSnapshot = {
	title: string;
	description: string;
	language: string;
	license: string;
	resourceType: string;
	keywords: string | null;
	author: string | null;
	publisher: string | null;
	subjects: string[];
	levels: string[];
};

function toStringOrNull(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function toStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

/** Normaliza un jsonb arbitrario al snapshot tipado. */
export function parseVersionSnapshot(value: unknown): ResourceVersionSnapshot {
	const raw = (value ?? {}) as Record<string, unknown>;
	return {
		title: toStringOrNull(raw.title) ?? "",
		description: toStringOrNull(raw.description) ?? "",
		language: toStringOrNull(raw.language) ?? "",
		license: toStringOrNull(raw.license) ?? "",
		resourceType: toStringOrNull(raw.resourceType) ?? "",
		keywords: toStringOrNull(raw.keywords),
		author: toStringOrNull(raw.author),
		publisher: toStringOrNull(raw.publisher),
		subjects: toStringArray(raw.subjects),
		levels: toStringArray(raw.levels),
	};
}

async function buildResourceSnapshot(
	tx: DrizzleDB,
	resourceId: string,
): Promise<ResourceVersionSnapshot> {
	const [resource] = await tx
		.select({
			title: resources.title,
			description: resources.description,
			language: resources.language,
			license: resources.license,
			resourceType: resources.resourceType,
			keywords: resources.keywords,
			author: resources.author,
			publisher: resources.publisher,
		})
		.from(resources)
		.where(eq(resources.id, resourceId))
		.limit(1);

	if (!resource) throw new Error("Recurso no encontrado");

	const [subjects, levels] = await Promise.all([
		tx
			.select({ subject: resourceSubjects.subject })
			.from(resourceSubjects)
			.where(eq(resourceSubjects.resourceId, resourceId)),
		tx
			.select({ level: resourceLevels.level })
			.from(resourceLevels)
			.where(eq(resourceLevels.resourceId, resourceId)),
	]);

	return {
		...resource,
		subjects: subjects.map((row) => row.subject),
		levels: levels.map((row) => row.level),
	};
}

async function lockResource(tx: DrizzleDB, resourceId: string) {
	const rows = await tx
		.select({ id: resources.id })
		.from(resources)
		.where(and(eq(resources.id, resourceId), isNull(resources.deletedAt)))
		.for("update");
	if (!rows[0]) throw new Error("Recurso no encontrado");
}

async function nextVersionNumber(
	tx: DrizzleDB,
	resourceId: string,
): Promise<number> {
	const [row] = await tx
		.select({
			max: sql<number>`COALESCE(MAX(${resourceVersions.versionNumber}), 0)`,
		})
		.from(resourceVersions)
		.where(eq(resourceVersions.resourceId, resourceId));
	return Number(row?.max ?? 0) + 1;
}

async function insertVersion(
	tx: DrizzleDB,
	data: {
		resourceId: string;
		versionNumber: number;
		elpxProjectId: string;
		fileSha256: string;
		snapshot: ResourceVersionSnapshot;
		createdBy: string | null;
	},
) {
	const id = crypto.randomUUID();
	await tx.insert(resourceVersions).values({
		id,
		resourceId: data.resourceId,
		versionNumber: data.versionNumber,
		elpxProjectId: data.elpxProjectId,
		fileSha256: data.fileSha256,
		metadataSnapshot: data.snapshot,
		createdBy: data.createdBy,
		createdAt: new Date(),
	});
	await tx
		.update(resources)
		.set({ currentVersionId: id, updatedAt: new Date() })
		.where(eq(resources.id, data.resourceId));
	return id;
}

/**
 * Crea una nueva versión a partir de un proyecto elpx.
 * Bloquea el recurso, asigna el siguiente número, guarda el snapshot y mueve
 * `resources.current_version_id` a la nueva versión.
 */
export async function publishResourceVersion(
	db: DrizzleDB,
	input: {
		resourceId: string;
		elpxProjectId: string;
		createdBy?: string | null;
	},
) {
	return db.transaction(async (tx: DrizzleDB) => {
		await lockResource(tx, input.resourceId);

		const [project] = await tx
			.select({
				id: elpxProjects.id,
				resourceId: elpxProjects.resourceId,
				hash: elpxProjects.hash,
				uploadSessionId: elpxProjects.uploadSessionId,
			})
			.from(elpxProjects)
			.where(eq(elpxProjects.id, input.elpxProjectId))
			.limit(1);
		if (!project || project.resourceId !== input.resourceId) {
			throw new Error("El proyecto elpx no pertenece al recurso");
		}

		let fileSha256 = project.hash;
		if (project.uploadSessionId) {
			const [session] = await tx
				.select({ finalChecksum: uploadSessions.finalChecksum })
				.from(uploadSessions)
				.where(eq(uploadSessions.id, project.uploadSessionId))
				.limit(1);
			if (session?.finalChecksum) fileSha256 = session.finalChecksum;
		}

		const versionNumber = await nextVersionNumber(tx, input.resourceId);
		const snapshot = await buildResourceSnapshot(tx, input.resourceId);
		const id = await insertVersion(tx, {
			resourceId: input.resourceId,
			versionNumber,
			elpxProjectId: project.id,
			fileSha256,
			snapshot,
			createdBy: input.createdBy ?? null,
		});

		return { id, versionNumber };
	});
}

/** Historial de versiones, de la más reciente a la más antigua. */
export async function listResourceVersions(db: DrizzleDB, resourceId: string) {
	return db
		.select({
			id: resourceVersions.id,
			versionNumber: resourceVersions.versionNumber,
			fileSha256: resourceVersions.fileSha256,
			elpxProjectId: resourceVersions.elpxProjectId,
			createdBy: resourceVersions.createdBy,
			createdByName: user.name,
			createdAt: resourceVersions.createdAt,
			originalFilename: elpxProjects.originalFilename,
			uploadSessionId: elpxProjects.uploadSessionId,
			isCurrent: sql<boolean>`COALESCE(${resources.currentVersionId} = ${resourceVersions.id}, false)`,
		})
		.from(resourceVersions)
		.innerJoin(resources, eq(resourceVersions.resourceId, resources.id))
		.leftJoin(user, eq(resourceVersions.createdBy, user.id))
		.leftJoin(elpxProjects, eq(resourceVersions.elpxProjectId, elpxProjects.id))
		.where(eq(resourceVersions.resourceId, resourceId))
		.orderBy(desc(resourceVersions.versionNumber));
}

export async function getResourceVersionById(db: DrizzleDB, versionId: string) {
	const rows = await db
		.select()
		.from(resourceVersions)
		.where(eq(resourceVersions.id, versionId))
		.limit(1);
	return rows[0] ?? null;
}

/** Restauración no destructiva: crea una versión nueva desde la seleccionada. */
export async function restoreResourceVersion(
	db: DrizzleDB,
	input: {
		resourceId: string;
		versionId: string;
		createdBy?: string | null;
	},
) {
	return db.transaction(async (tx: DrizzleDB) => {
		await lockResource(tx, input.resourceId);

		const [target] = await tx
			.select()
			.from(resourceVersions)
			.where(eq(resourceVersions.id, input.versionId))
			.limit(1);
		if (!target || target.resourceId !== input.resourceId) {
			throw new Error("La versión no pertenece al recurso");
		}

		const snapshot = parseVersionSnapshot(target.metadataSnapshot);
		const versionNumber = await nextVersionNumber(tx, input.resourceId);
		const id = await insertVersion(tx, {
			resourceId: input.resourceId,
			versionNumber,
			elpxProjectId: target.elpxProjectId,
			fileSha256: target.fileSha256,
			snapshot,
			createdBy: input.createdBy ?? null,
		});

		await tx
			.update(resources)
			.set({
				title: snapshot.title,
				description: snapshot.description,
				language: snapshot.language,
				license: snapshot.license,
				resourceType: snapshot.resourceType,
				keywords: snapshot.keywords,
				author: snapshot.author,
				publisher: snapshot.publisher,
				updatedAt: new Date(),
			})
			.where(eq(resources.id, input.resourceId));

		await tx
			.delete(resourceSubjects)
			.where(eq(resourceSubjects.resourceId, input.resourceId));
		for (const subject of snapshot.subjects) {
			await tx.insert(resourceSubjects).values({ resourceId: input.resourceId, subject });
		}
		await tx
			.delete(resourceLevels)
			.where(eq(resourceLevels.resourceId, input.resourceId));
		for (const level of snapshot.levels) {
			await tx.insert(resourceLevels).values({ resourceId: input.resourceId, level });
		}

		if (typeof snapshot.keywords === "string") {
			const { syncTagsFromKeywords } = await import("./tags.ts");
			await syncTagsFromKeywords(tx, input.resourceId, snapshot.keywords);
		}

		return {
			id,
			versionNumber,
			restoredFromVersionNumber: target.versionNumber,
		};
	});
}

export async function countVersionsReferencingElpxProject(
	db: DrizzleDB,
	elpxProjectId: string,
): Promise<number> {
	const [row] = await db
		.select({ count: sql<number>`count(*)` })
		.from(resourceVersions)
		.where(eq(resourceVersions.elpxProjectId, elpxProjectId));
	return Number(row?.count ?? 0);
}

export async function isUploadSessionReferencedByVersions(
	db: DrizzleDB,
	uploadSessionId: string,
): Promise<boolean> {
	const [row] = await db
		.select({ count: sql<number>`count(*)` })
		.from(resourceVersions)
		.innerJoin(
			elpxProjects,
			eq(resourceVersions.elpxProjectId, elpxProjects.id),
		)
		.where(eq(elpxProjects.uploadSessionId, uploadSessionId));
	return Number(row?.count ?? 0) > 0;
}
