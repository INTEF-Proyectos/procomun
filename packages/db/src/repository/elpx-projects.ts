import { desc, eq, sql } from "drizzle-orm";
import { elpxProjects } from "../schema/elpx.ts";
import { resources } from "../schema/resources.ts";
import { resourceVersions } from "../schema/versions.ts";
import type { DrizzleDB } from "./shared.ts";

export async function createElpxProject(
	db: DrizzleDB,
	data: {
		resourceId: string;
		hash: string;
		extractPath: string;
		originalFilename: string;
		uploadSessionId?: string | null;
		version?: number;
		hasPreview?: boolean;
		elpxMetadata?: Record<string, unknown> | null;
	},
) {
	const id = crypto.randomUUID();
	await db.insert(elpxProjects).values({
		id,
		resourceId: data.resourceId,
		hash: data.hash,
		extractPath: data.extractPath,
		originalFilename: data.originalFilename,
		uploadSessionId: data.uploadSessionId ?? null,
		version: data.version ?? 3,
		hasPreview: data.hasPreview ?? false,
		elpxMetadata: data.elpxMetadata ?? null,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	return { id };
}

/**
 * Copia de trabajo del autor: el proyecto elpx más reciente del recurso.
 * Con versionado (issue #31) un recurso puede tener varios proyectos; los
 * flujos de edición/reemplazo operan siempre sobre el último subido.
 */
export async function getElpxProjectByResourceId(
	db: DrizzleDB,
	resourceId: string,
) {
	const rows = await db
		.select()
		.from(elpxProjects)
		.where(eq(elpxProjects.resourceId, resourceId))
		.orderBy(desc(elpxProjects.createdAt))
		.limit(1);
	return rows[0] ?? null;
}

/**
 * Proyecto elpx de la versión vigente (resources.current_version_id).
 * Es lo que deben servir ficha pública, previsualización y descargas.
 * Sin versiones publicadas cae a la copia de trabajo (borradores).
 */
export async function getCurrentElpxProjectByResourceId(
	db: DrizzleDB,
	resourceId: string,
) {
	const rows = await db
		.select({ project: elpxProjects })
		.from(resources)
		.innerJoin(
			resourceVersions,
			eq(resources.currentVersionId, resourceVersions.id),
		)
		.innerJoin(
			elpxProjects,
			eq(resourceVersions.elpxProjectId, elpxProjects.id),
		)
		.where(eq(resources.id, resourceId))
		.limit(1);
	if (rows[0]) return rows[0].project;
	return getElpxProjectByResourceId(db, resourceId);
}

export async function getElpxProjectByHash(db: DrizzleDB, hash: string) {
	const rows = await db
		.select()
		.from(elpxProjects)
		.where(eq(elpxProjects.hash, hash))
		.limit(1);
	return rows[0] ?? null;
}

export async function deleteElpxProject(db: DrizzleDB, id: string) {
	await db.delete(elpxProjects).where(eq(elpxProjects.id, id));
}

/**
 * Proyecto elpx a mostrar por recurso en listados públicos: el de la versión
 * vigente si existe; si no, el más reciente (recursos aún sin versionar).
 */
export async function listElpxProjectsByResourceIds(
	db: DrizzleDB,
	resourceIds: string[],
) {
	if (!resourceIds.length) return [];
	const rows = await db
		.select({
			resourceId: elpxProjects.resourceId,
			hash: elpxProjects.hash,
			hasPreview: elpxProjects.hasPreview,
			createdAt: elpxProjects.createdAt,
			isCurrent: sql<boolean>`COALESCE(${resourceVersions.elpxProjectId} = ${elpxProjects.id}, false)`,
		})
		.from(elpxProjects)
		.leftJoin(resources, eq(elpxProjects.resourceId, resources.id))
		.leftJoin(
			resourceVersions,
			eq(resources.currentVersionId, resourceVersions.id),
		)
		.where(
			sql`${elpxProjects.resourceId} IN (${sql.join(
				resourceIds.map((id) => sql`${id}`),
				sql`, `,
			)})`,
		);

	const byResource = new Map<
		string,
		{ resourceId: string; hash: string; hasPreview: boolean }
	>();
	const pick = new Map<string, (typeof rows)[number]>();
	for (const row of rows) {
		const previous = pick.get(row.resourceId);
		const winner =
			!previous ||
			(row.isCurrent && !previous.isCurrent) ||
			(row.isCurrent === previous.isCurrent &&
				row.createdAt > previous.createdAt)
				? row
				: previous;
		pick.set(row.resourceId, winner);
	}
	for (const [resourceId, row] of pick) {
		byResource.set(resourceId, {
			resourceId,
			hash: row.hash,
			hasPreview: row.hasPreview,
		});
	}
	return [...byResource.values()];
}
