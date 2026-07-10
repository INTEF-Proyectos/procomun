import { and, eq } from "drizzle-orm";
import { elpxProjects } from "../schema/elpx.ts";
import { mediaItems, resourceLevels, resourceSubjects, resources } from "../schema/resources.ts";
import { uploadSessions } from "../schema/uploads.ts";
import { buildSlug, type DrizzleDB } from "./shared.ts";

export interface LegacyResourceInput {
	externalId: string;
	importSource: string;
	sourceUri: string | null;
	title: string;
	description: string;
	language: string;
	/** No debe ser null aquí: comprobar MappingResult.blocking antes de llamar */
	license: string;
	resourceType: string;
	subjects: string[];
	levels: string[];
	author: string | null;
	publisher: string | null;
	keywords: string | null;
	importedAt: Date | null;
}

export interface LegacyElpxInput {
	hash: string;
	extractPath: string;
	originalFilename: string;
	hasPreview: boolean;
	elpxMetadata: Record<string, unknown> | null;
}

export interface LegacyMediaInput {
	/** UUID pre-generado por el llamante: es también el nombre del fichero en storageDir */
	uploadId: string;
	ownerId: string;
	fileSize: number;
	mimeType: string;
	url: string;
	storageKey: string;
	finalChecksum: string | null;
}

export interface ImportLegacyResourceResult {
	resourceId: string;
	slug: string;
	mediaItemId: string;
	elpxProjectId: string;
}

/**
 * Busca un recurso ya importado por (import_source, external_id) — la misma
 * clave protegida por el índice único `resources_import_source_external_id_idx`
 * (ADR-0029). Se usa antes de insertar para hacer el importador idempotente:
 * un registro ya existente se cuenta como omitido, no como error.
 */
export async function findLegacyResourceByExternalId(
	db: DrizzleDB,
	importSource: string,
	externalId: string,
) {
	const rows = await db
		.select({ id: resources.id, slug: resources.slug })
		.from(resources)
		.where(and(eq(resources.importSource, importSource), eq(resources.externalId, externalId)))
		.limit(1);
	return rows[0] ?? null;
}

/**
 * Persiste un recurso legacy importado junto con su proyecto .elpx en una
 * única transacción (resources, resource_subjects, resource_levels,
 * elpx_projects, media_items, upload_sessions). Un fallo aquí no afecta a
 * registros ya confirmados de otras llamadas — cada recurso es su propia
 * transacción, no hay commit por lote (ver design.md de epic-004).
 */
export async function importLegacyResourceWithElpx(
	db: DrizzleDB,
	input: { resource: LegacyResourceInput; elpx: LegacyElpxInput; media: LegacyMediaInput },
): Promise<ImportLegacyResourceResult> {
	return db.transaction(async (tx: DrizzleDB) => {
		const resourceId = crypto.randomUUID();
		const slug = `${buildSlug(input.resource.title)}-${resourceId.slice(0, 8)}`;
		const now = new Date();

		await tx.insert(resources).values({
			id: resourceId,
			slug,
			externalId: input.resource.externalId,
			importSource: input.resource.importSource,
			sourceUri: input.resource.sourceUri,
			title: input.resource.title,
			description: input.resource.description,
			language: input.resource.language,
			license: input.resource.license,
			resourceType: input.resource.resourceType,
			keywords: input.resource.keywords,
			author: input.resource.author,
			publisher: input.resource.publisher,
			editorialStatus: "draft",
			importedAt: input.resource.importedAt,
			createdAt: now,
			updatedAt: now,
		});

		if (input.resource.subjects.length) {
			await tx
				.insert(resourceSubjects)
				.values(input.resource.subjects.map((subject) => ({ resourceId, subject })));
		}
		if (input.resource.levels.length) {
			await tx
				.insert(resourceLevels)
				.values(input.resource.levels.map((level) => ({ resourceId, level })));
		}

		const mediaItemId = crypto.randomUUID();
		await tx.insert(mediaItems).values({
			id: mediaItemId,
			resourceId,
			type: "file",
			mimeType: input.media.mimeType,
			url: input.media.url,
			fileSize: input.media.fileSize,
			filename: input.elpx.originalFilename,
			isPrimary: true,
		});

		await tx.insert(uploadSessions).values({
			id: input.media.uploadId,
			resourceId,
			ownerId: input.media.ownerId,
			originalFilename: input.elpx.originalFilename,
			mimeType: input.media.mimeType,
			storageKey: input.media.storageKey,
			status: "completed",
			receivedBytes: input.media.fileSize,
			declaredSize: input.media.fileSize,
			publicUrl: input.media.url,
			mediaItemId,
			finalChecksum: input.media.finalChecksum,
			completedAt: now,
			createdAt: now,
			updatedAt: now,
		});

		const elpxProjectId = crypto.randomUUID();
		await tx.insert(elpxProjects).values({
			id: elpxProjectId,
			resourceId,
			hash: input.elpx.hash,
			extractPath: input.elpx.extractPath,
			originalFilename: input.elpx.originalFilename,
			uploadSessionId: input.media.uploadId,
			version: 3,
			hasPreview: input.elpx.hasPreview,
			elpxMetadata: input.elpx.elpxMetadata,
			createdAt: now,
			updatedAt: now,
		});

		return { resourceId, slug, mediaItemId, elpxProjectId };
	});
}
