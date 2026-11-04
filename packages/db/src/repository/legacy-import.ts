import { and, eq, isNull, sql } from "drizzle-orm";
import {
	type EducationalImportResourceNote,
	mapLegacyEducationalCategories,
} from "../legacy-import/educational-category-map.ts";
import { IMPORT_SOURCE } from "../legacy-import/field-mapper.ts";
import type { LegacyEditorialStatus } from "../legacy-import/publication-status.ts";
import { elpxProjects } from "../schema/elpx.ts";
import {
	mediaItems,
	resourceEducationalAreas,
	resourceLevels,
	resourceSubjects,
	resources,
} from "../schema/resources.ts";
import { resourceViewCounts } from "../schema/social.ts";
import { uploadSessions } from "../schema/uploads.ts";
import { buildSlug, type DrizzleDB } from "./shared.ts";

export interface LegacyResourceInput {
	externalId: string;
	importSource: string;
	sourceUri: string | null;
	title: string;
	description: string;
	language: string | null;
	/** No debe ser null aquí: comprobar MappingResult.blocking antes de llamar */
	license: string;
	resourceType: string;
	subjects: string[];
	levels: string[];
	author: string | null;
	otherAuthors?: string | null;
	publisher: string | null;
	keywords: string | null;
	importedAt: Date | null;
	previewImageUrl: string | null;
	/** Calculado desde `published` del JSON (ver resolveLegacyPublicationStatus). */
	editorialStatus: LegacyEditorialStatus;
	/**
	 * Visitas del Procomún antiguo (#421, ADR-0044): valor inicial del contador.
	 * Pendiente: el exportador aún no incluye el dato, así que hoy llega vacío.
	 */
	legacyViewCount?: number | null;
	/**
	 * Cuenta cuyo correo coincide con `publicatorEmailStr` (#456). Sin cuenta
	 * queda vacío y el recurso sigue a nombre del sistema, como hasta ahora.
	 */
	createdBy?: string | null;
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
		// createdBy: el informe tiene que distinguir un recurso que sigue sin
		// autor de uno reasignado a mano cuyo correo de origen no lleva a
		// ninguna cuenta (revisión #508).
		.select({
			id: resources.id,
			slug: resources.slug,
			createdBy: resources.createdBy,
		})
		.from(resources)
		.where(
			and(
				eq(resources.importSource, importSource),
				eq(resources.externalId, externalId),
			),
		)
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
	input: {
		resource: LegacyResourceInput;
		elpx: LegacyElpxInput;
		media: LegacyMediaInput;
	},
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
			otherAuthors: input.resource.otherAuthors ?? null,
			publisher: input.resource.publisher,
			createdBy: input.resource.createdBy ?? null,
			thumbnailUrl: input.resource.previewImageUrl,
			// Solo se publica lo que el Procomún antiguo tenía publicado
			// (`published: 1`); el resto entra como borrador (issue #447, ver
			// Actualización 2026-10-22 en ADR-0029).
			editorialStatus: input.resource.editorialStatus,
			importedAt: input.resource.importedAt,
			// El catálogo público ordena por createdAt DESC (listResources()); usar
			// el instante de ejecución del importador aquí haría que TODO el
			// catálogo legacy apareciese como "recién creado" y desplazase
			// contenido genuinamente reciente. Se usa la fecha de origen
			// (importedAt) para conservar la cronología histórica real, con
			// fallback a "now" solo si no pudo resolverse ninguna fecha de origen.
			createdAt: input.resource.importedAt ?? now,
			updatedAt: now,
		});

		if (input.resource.subjects.length) {
			await tx
				.insert(resourceSubjects)
				.values(
					input.resource.subjects.map((subject) => ({ resourceId, subject })),
				);
		}
		if (input.resource.levels.length) {
			await tx
				.insert(resourceLevels)
				.values(input.resource.levels.map((level) => ({ resourceId, level })));
		}
		// learningContext se conserva en resource_levels. La categorización
		// nueva sale de esas mismas cadenas; lo no reconocido no se asigna.
		const educationalAreas = mapLegacyEducationalCategories(
			input.resource.levels,
			input.resource.language,
		).assignments;
		if (educationalAreas.length > 0) {
			await tx.insert(resourceEducationalAreas).values(
				educationalAreas.map((area) => ({
					resourceId,
					categoryId: area.categoryId,
					optionId: area.optionId,
				})),
			);
		}

		const legacyViewCount = input.resource.legacyViewCount;
		if (
			typeof legacyViewCount === "number" &&
			Number.isInteger(legacyViewCount) &&
			legacyViewCount > 0
		) {
			await tx
				.insert(resourceViewCounts)
				.values({ resourceId, legacyViewCount, updatedAt: now });
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

export type UnpublishLegacyResourceResult =
	| { outcome: "not_found"; resourceId: null }
	| {
			outcome: "not_published" | "reviewed" | "unpublished";
			resourceId: string;
	  };

/**
 * Corrección de #447 para lo importado antes de leer `published`: pasa a
 * borrador un recurso legacy publicado, salvo que ya tenga una decisión
 * editorial posterior (curator asignado, fecha de curación o destacado). Esa
 * misma condición va en el UPDATE para no pisar una revisión concurrente.
 */
export async function unpublishUnreviewedLegacyResource(
	db: DrizzleDB,
	importSource: string,
	externalId: string,
	options: { dryRun: boolean },
): Promise<UnpublishLegacyResourceResult> {
	const [row] = await db
		.select({
			id: resources.id,
			editorialStatus: resources.editorialStatus,
			assignedCuratorId: resources.assignedCuratorId,
			curatedAt: resources.curatedAt,
			featuredAt: resources.featuredAt,
		})
		.from(resources)
		.where(
			and(
				eq(resources.importSource, importSource),
				eq(resources.externalId, externalId),
				isNull(resources.deletedAt),
			),
		)
		.limit(1);
	if (!row) return { outcome: "not_found", resourceId: null };
	if (row.editorialStatus !== "published") {
		return { outcome: "not_published", resourceId: row.id };
	}
	if (row.assignedCuratorId || row.curatedAt || row.featuredAt) {
		return { outcome: "reviewed", resourceId: row.id };
	}
	if (!options.dryRun) {
		await db
			.update(resources)
			.set({ editorialStatus: "draft", updatedAt: new Date() })
			.where(
				and(
					eq(resources.id, row.id),
					eq(resources.editorialStatus, "published"),
					isNull(resources.assignedCuratorId),
					isNull(resources.curatedAt),
					isNull(resources.featuredAt),
				),
			);
	}
	return { outcome: "unpublished", resourceId: row.id };
}

export type FixLegacyLanguageResult =
	| { outcome: "not_found"; resourceId: null }
	| {
			outcome: "fixed" | "unchanged" | "kept";
			resourceId: string;
			/** Idioma que tenía antes de esta pasada. */
			language: string | null;
	  };

/**
 * Corrección de #473: hasta el arreglo el importador ponía "es" a lo que no
 * traía un idioma reconocible en generalLanguageStr (sin idioma, "va", o solo
 * el «Idioma destinatario»). Solo se toca un recurso que siga en "es": un
 * idioma distinto vino del origen o de una edición y se respeta ("kept").
 */
export async function fixLegacyResourceLanguage(
	db: DrizzleDB,
	importSource: string,
	externalId: string,
	sourceLanguage: string | null,
	options: { dryRun: boolean },
): Promise<FixLegacyLanguageResult> {
	const [row] = await db
		.select({ id: resources.id, language: resources.language })
		.from(resources)
		.where(
			and(
				eq(resources.importSource, importSource),
				eq(resources.externalId, externalId),
				isNull(resources.deletedAt),
			),
		)
		.limit(1);
	if (!row) return { outcome: "not_found", resourceId: null };
	if (row.language === sourceLanguage) {
		return { outcome: "unchanged", resourceId: row.id, language: row.language };
	}
	if (row.language !== "es") {
		return { outcome: "kept", resourceId: row.id, language: row.language };
	}
	if (!options.dryRun) {
		await db
			.update(resources)
			.set({ language: sourceLanguage, updatedAt: new Date() })
			.where(and(eq(resources.id, row.id), eq(resources.language, "es")));
	}
	return { outcome: "fixed", resourceId: row.id, language: row.language };
}

/**
 * Relleno de la categorización educativa (#383) para los recursos legacy
 * importados antes de la correspondencia: aplica las mismas reglas a su
 * resource_levels, que guarda el learningContext original. Solo toca recursos
 * sin ninguna clasificación, así que repetirlo no cambia nada y no pisa lo
 * editado a mano. Devuelve las notas para el mismo informe que la importación.
 */
export async function backfillLegacyEducationalAreas(
	db: DrizzleDB,
	options: { dryRun: boolean },
): Promise<EducationalImportResourceNote[]> {
	const rows = await db
		.select({
			id: resources.id,
			externalId: resources.externalId,
			language: resources.language,
			level: resourceLevels.level,
		})
		.from(resources)
		.leftJoin(resourceLevels, eq(resourceLevels.resourceId, resources.id))
		.where(
			and(
				eq(resources.importSource, IMPORT_SOURCE),
				isNull(resources.deletedAt),
				sql`not exists (
					select 1 from resource_educational_areas ea
					where ea.resource_id = ${resources.id}
				)`,
			),
		)
		.orderBy(resources.externalId);

	const byResource = new Map<string, EducationalImportResourceNote>();
	for (const row of rows) {
		const note = byResource.get(row.id) ?? {
			externalId: row.externalId ?? row.id,
			sourceCategories: [],
			language: row.language,
		};
		if (row.level)
			note.sourceCategories = [...note.sourceCategories, row.level];
		byResource.set(row.id, note);
	}

	for (const [resourceId, note] of byResource) {
		const { assignments } = mapLegacyEducationalCategories(
			note.sourceCategories,
			note.language,
		);
		if (options.dryRun || assignments.length === 0) continue;
		await db
			.insert(resourceEducationalAreas)
			.values(assignments.map((area) => ({ resourceId, ...area })));
	}
	return [...byResource.values()];
}

/**
 * Recursos legacy cuya miniatura sigue enlazada en caliente (#409): la
 * importación anterior guardaba la URL de `preview` tal cual.
 */
export async function listLegacyRemoteThumbnails(
	db: DrizzleDB,
	importSource: string,
) {
	return db
		.select({
			id: resources.id,
			externalId: resources.externalId,
			thumbnailUrl: resources.thumbnailUrl,
		})
		.from(resources)
		.where(
			and(
				eq(resources.importSource, importSource),
				sql`${resources.thumbnailUrl} ~* '^https?://'`,
			),
		)
		.orderBy(resources.externalId);
}

export async function setResourceThumbnailUrl(
	db: DrizzleDB,
	resourceId: string,
	thumbnailUrl: string | null,
) {
	await db
		.update(resources)
		.set({ thumbnailUrl })
		.where(eq(resources.id, resourceId));
}
