import { and, asc, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { normalizeEducationalAssignments } from "../educational-areas.ts";
import { user } from "../schema/auth.ts";
import {
	mediaItems,
	resourceLevels,
	resourceSubjects,
	resources,
} from "../schema/resources.ts";
import { resourceTags, tags } from "../schema/tags.ts";
import { uploadSessions } from "../schema/uploads.ts";
import {
	listResourceEducationalAreas,
	replaceResourceEducationalAreas,
} from "./educational-areas.ts";
import {
	andWhere,
	buildSearchTerm,
	buildSlug,
	type DrizzleDB,
	normalizeMediaUrl,
	normalizePagination,
	normalizeSearch,
} from "./shared.ts";

type ResourceListOptions = {
	limit?: number;
	offset?: number;
	search?: string;
	status?: string;
	resourceType?: string;
	language?: string;
	license?: string;
	/** Filter by atomized tag slug (canonical or synonym). Issue #310. */
	tagSlug?: string;
	/** Categoría educativa principal (issue #380). Incluye recursos con y sin opción. */
	educationalCategory?: string;
	/** Opción secundaria. Solo aplica junto a educationalCategory y exige la combinación exacta. */
	educationalOption?: string;
	createdBy?: string;
	visibleToUserId?: string;
	/**
	 * Oculta los borradores que no ha creado este usuario (#460). Es la versión
	 * SQL de `isOthersPrivateDraft` (validation.ts) para el listado del curator.
	 */
	hideOthersDraftsFor?: string;
};

type ResourceMutationInput = {
	title: string;
	description: string;
	language: string;
	license: string;
	resourceType: string;
	keywords?: string;
	author?: string;
	publisher?: string;
	subjects?: string[];
	levels?: string[];
	educationalAreas?: unknown;
	createdBy?: string;
	editorialStatus?: string;
};

const resourceBaseSelection = {
	id: resources.id,
	slug: resources.slug,
	externalId: resources.externalId,
	sourceUri: resources.sourceUri,
	title: resources.title,
	description: resources.description,
	language: resources.language,
	license: resources.license,
	resourceType: resources.resourceType,
	keywords: resources.keywords,
	author: resources.author,
	publisher: resources.publisher,
	thumbnailUrl: resources.thumbnailUrl,
	createdBy: resources.createdBy,
	createdByName: user.name,
	editorialStatus: resources.editorialStatus,
	assignedCuratorId: resources.assignedCuratorId,
	curatedAt: resources.curatedAt,
	deletedAt: resources.deletedAt,
	createdAt: resources.createdAt,
	updatedAt: resources.updatedAt,
};

const resourceListSelection = {
	...resourceBaseSelection,
	featuredAt: resources.featuredAt,
	favoriteCount: sql<number>`(SELECT count(*) FROM favorites WHERE favorites.resource_id = ${resources.id})`,
	ratingAvg: sql<number>`(SELECT coalesce(avg(score), 0) FROM ratings WHERE ratings.resource_id = ${resources.id})`,
	ratingCount: sql<number>`(SELECT count(*) FROM ratings WHERE ratings.resource_id = ${resources.id})`,
};

const resourceDetailSelection = {
	...resourceBaseSelection,
	assignedCuratorId: resources.assignedCuratorId,
	curatedAt: resources.curatedAt,
};

async function listResourceTaxonomyValues(db: DrizzleDB, resourceId: string) {
	const [subjects, levels, educationalAreas] = await Promise.all([
		db
			.select({ subject: resourceSubjects.subject })
			.from(resourceSubjects)
			.where(eq(resourceSubjects.resourceId, resourceId)),
		db
			.select({ level: resourceLevels.level })
			.from(resourceLevels)
			.where(eq(resourceLevels.resourceId, resourceId)),
		listResourceEducationalAreas(db, resourceId),
	]);

	return {
		subjects: subjects.map((subject: { subject: string }) => subject.subject),
		levels: levels.map((level: { level: string }) => level.level),
		educationalAreas,
	};
}

async function attachResourceTaxonomies<
	TResource extends {
		id: string;
	},
>(db: DrizzleDB, resource: TResource) {
	return {
		...resource,
		...(await listResourceTaxonomyValues(db, resource.id)),
	};
}

export async function listResources(db: DrizzleDB, opts: ResourceListOptions) {
	const { limit, offset } = normalizePagination(opts.limit, opts.offset);
	const conditions = [isNull(resources.deletedAt)];

	if (opts.search) {
		const term = buildSearchTerm(opts.search);
		conditions.push(
			// DEF-014: incluir el nombre del creador (user.name, mostrado como
			// "autor" en el listado) además del campo de texto libre `author`.
			sql`(${normalizeSearch(resources.title)} LIKE ${term} OR
                 ${normalizeSearch(resources.description)} LIKE ${term} OR
                 ${normalizeSearch(resources.author)} LIKE ${term} OR
                 ${normalizeSearch(user.name)} LIKE ${term} OR
                 ${normalizeSearch(resources.keywords)} LIKE ${term})`,
		);
	}
	if (opts.status) conditions.push(eq(resources.editorialStatus, opts.status));
	if (opts.resourceType)
		conditions.push(eq(resources.resourceType, opts.resourceType));
	if (opts.language) conditions.push(eq(resources.language, opts.language));
	if (opts.license) conditions.push(eq(resources.license, opts.license));
	if (opts.educationalCategory) {
		const categoryId = opts.educationalCategory;
		if (opts.educationalOption) {
			const optionId = opts.educationalOption;
			conditions.push(
				sql`exists (
					select 1
					from resource_educational_areas ea
					where ea.resource_id = ${resources.id}
						and ea.category_id = ${categoryId}
						and ea.option_id = ${optionId}
				)`,
			);
		} else {
			conditions.push(
				sql`exists (
					select 1
					from resource_educational_areas ea
					where ea.resource_id = ${resources.id}
						and ea.category_id = ${categoryId}
				)`,
			);
		}
	}
	if (opts.tagSlug) {
		const slug = opts.tagSlug;
		// Match resources linked to the tag or its canonical / synonyms (#76 / #310).
		conditions.push(
			sql`exists (
				select 1
				from ${resourceTags} rt
				inner join ${tags} t on t.id = rt.tag_id
				where rt.resource_id = ${resources.id}
					and (
						t.slug = ${slug}
						or t.id = (
							select coalesce(c.canonical_tag_id, c.id)
							from ${tags} c
							where c.slug = ${slug}
							limit 1
						)
						or t.canonical_tag_id = (
							select coalesce(c.canonical_tag_id, c.id)
							from ${tags} c
							where c.slug = ${slug}
							limit 1
						)
					)
			)`,
		);
	}
	if (opts.createdBy) conditions.push(eq(resources.createdBy, opts.createdBy));
	if (opts.hideOthersDraftsFor) {
		const ownOrNotDraft = or(
			ne(resources.editorialStatus, "draft"),
			eq(resources.createdBy, opts.hideOthersDraftsFor),
		);
		if (ownOrNotDraft) conditions.push(ownOrNotDraft);
	}
	if (opts.visibleToUserId) {
		const visibility = or(
			eq(resources.createdBy, opts.visibleToUserId),
			eq(resources.assignedCuratorId, opts.visibleToUserId),
		);
		if (visibility) conditions.push(visibility);
	}

	const where = andWhere(conditions);
	const rows = await db
		.select(resourceListSelection)
		.from(resources)
		.leftJoin(user, eq(resources.createdBy, user.id))
		.where(where)
		.limit(limit)
		.offset(offset)
		.orderBy(desc(resources.createdAt));

	const countResult = await db
		.select({ count: sql<number>`count(*)` })
		.from(resources)
		// El join debe coincidir con la consulta de datos: el filtro de búsqueda
		// puede referirse a user.name (DEF-014).
		.leftJoin(user, eq(resources.createdBy, user.id))
		.where(where);

	return {
		data: rows,
		total: Number(countResult[0]?.count ?? 0),
		limit,
		offset,
	};
}

export async function getResourceById(db: DrizzleDB, id: string) {
	const rows = await db
		.select(resourceDetailSelection)
		.from(resources)
		.leftJoin(user, eq(resources.createdBy, user.id))
		.where(and(eq(resources.id, id), isNull(resources.deletedAt)))
		.limit(1);

	const resource = rows[0];
	if (!resource) return null;

	return attachResourceTaxonomies(db, resource);
}

export async function getResourceBySlug(db: DrizzleDB, slug: string) {
	const rows = await db
		.select(resourceDetailSelection)
		.from(resources)
		.leftJoin(user, eq(resources.createdBy, user.id))
		.where(and(eq(resources.slug, slug), isNull(resources.deletedAt)))
		.limit(1);

	const resource = rows[0];
	if (!resource) return null;

	return {
		...(await attachResourceTaxonomies(db, resource)),
		mediaItems: await listMediaItemsForResource(db, resource.id),
	};
}

export async function createResource(
	db: DrizzleDB,
	data: ResourceMutationInput,
) {
	const educationalAreas =
		data.educationalAreas === undefined
			? undefined
			: normalizeEducationalAssignments(data.educationalAreas);
	const id = crypto.randomUUID();
	const slug = `${buildSlug(data.title)}-${id.slice(0, 8)}`;
	const now = new Date();

	await db.insert(resources).values({
		id,
		slug,
		title: data.title,
		description: data.description,
		language: data.language,
		license: data.license,
		resourceType: data.resourceType,
		keywords: data.keywords ?? null,
		author: data.author ?? null,
		publisher: data.publisher ?? null,
		createdBy: data.createdBy ?? null,
		editorialStatus: data.editorialStatus ?? "draft",
		createdAt: now,
		updatedAt: now,
	});

	if (data.subjects?.length) {
		for (const subject of data.subjects) {
			await db.insert(resourceSubjects).values({ resourceId: id, subject });
		}
	}

	if (data.levels?.length) {
		for (const level of data.levels) {
			await db.insert(resourceLevels).values({ resourceId: id, level });
		}
	}

	if (educationalAreas?.length) {
		await replaceResourceEducationalAreas(db, id, educationalAreas);
	}

	// Dual-write: free-text keywords → atomized tags (ADR-0034 / #76)
	if (data.keywords) {
		const { syncTagsFromKeywords } = await import("./tags.ts");
		await syncTagsFromKeywords(db, id, data.keywords);
	}

	return { id, slug };
}

// Campos descriptivos que el usuario puede editar libremente. NO incluye
// editorialStatus, createdBy, slug, assignedCuratorId, curatedAt, featuredAt,
// deletedAt, etc.: esas columnas solo cambian por sus rutas dedicadas y con sus
// controles de rol (p. ej. updateEditorialStatus + validateTransition).
const EDITABLE_RESOURCE_FIELDS = [
	"title",
	"description",
	"language",
	"license",
	"resourceType",
	"keywords",
	"author",
	"publisher",
] as const;

export type EditableResourceFields = Partial<
	Record<(typeof EDITABLE_RESOURCE_FIELDS)[number], string>
>;

/**
 * Reduce un objeto arbitrario al conjunto de campos descriptivos editables.
 * Defensa contra mass assignment: aunque la capa de ruta entregue el cuerpo
 * crudo, aquí nunca se escriben columnas sensibles (editorialStatus, createdBy,
 * slug, …) que llegarían como claves extra. Ver ADR de control de acceso.
 *
 * Solo acepta valores string: un número/objeto en un campo editable se ignora
 * (la validación de ruta debería rechazarlo antes; esto es defensa en profundidad).
 */
export function pickEditableResourceFields(
	data: Record<string, unknown>,
): EditableResourceFields {
	const safe: EditableResourceFields = {};
	for (const field of EDITABLE_RESOURCE_FIELDS) {
		const value = data[field];
		if (typeof value === "string") {
			safe[field] = value;
		}
	}
	return safe;
}

export async function updateResource(
	db: DrizzleDB,
	id: string,
	data: EditableResourceFields | Record<string, unknown>,
) {
	// Whitelist explícito: solo persistimos campos descriptivos. Cualquier otra
	// clave del cuerpo (editorialStatus, createdBy, slug, assignedCuratorId,
	// featuredAt, deletedAt, …) se descarta para evitar mass assignment.
	const raw = data as Record<string, unknown>;
	const educationalAreas =
		"educationalAreas" in raw
			? normalizeEducationalAssignments(raw.educationalAreas)
			: undefined;
	const safe = pickEditableResourceFields(raw);

	// Evita un UPDATE vacío si el cuerpo solo traía claves sensibles filtradas.
	if (Object.keys(safe).length === 0 && !educationalAreas) {
		return;
	}

	await db.transaction(async (tx: DrizzleDB) => {
		await tx
			.update(resources)
			.set({ ...safe, updatedAt: new Date() })
			.where(and(eq(resources.id, id), isNull(resources.deletedAt)));
		if (educationalAreas) {
			await replaceResourceEducationalAreas(tx, id, educationalAreas);
		}
	});

	// Dual-write keywords → tags when the free-text field is updated (#76)
	if (typeof safe.keywords === "string") {
		const { syncTagsFromKeywords } = await import("./tags.ts");
		await syncTagsFromKeywords(db, id, safe.keywords);
	}
}

export async function deleteResource(db: DrizzleDB, id: string) {
	await db
		.update(resources)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(and(eq(resources.id, id), isNull(resources.deletedAt)));
}

export async function updateEditorialStatus(
	db: DrizzleDB,
	id: string,
	status: string,
	curatorId: string,
) {
	const updates: Record<string, unknown> = {
		editorialStatus: status,
		assignedCuratorId: curatorId,
		updatedAt: new Date(),
	};
	if (status === "published" || status === "archived") {
		updates.curatedAt = new Date();
	}

	await db
		.update(resources)
		.set(updates)
		.where(and(eq(resources.id, id), isNull(resources.deletedAt)));
}

export async function listMediaItemsForResource(
	db: DrizzleDB,
	resourceId: string,
) {
	const rows = await db
		.select({
			id: mediaItems.id,
			resourceId: mediaItems.resourceId,
			type: mediaItems.type,
			mimeType: mediaItems.mimeType,
			url: mediaItems.url,
			fileSize: mediaItems.fileSize,
			filename: mediaItems.filename,
			isPrimary: mediaItems.isPrimary,
			uploadId: uploadSessions.id,
		})
		.from(mediaItems)
		.leftJoin(uploadSessions, eq(uploadSessions.mediaItemId, mediaItems.id))
		.where(eq(mediaItems.resourceId, resourceId))
		.orderBy(desc(mediaItems.isPrimary), asc(mediaItems.filename));

	return rows.map((row) => ({
		id: row.id,
		resourceId: row.resourceId,
		type: row.type,
		mimeType: row.mimeType,
		url: normalizeMediaUrl(row.url, row.uploadId),
		fileSize: row.fileSize,
		filename: row.filename,
		isPrimary: row.isPrimary,
		uploadId: row.uploadId,
	}));
}

export async function createMediaItem(
	db: DrizzleDB,
	data: {
		resourceId: string;
		type: string;
		mimeType?: string | null;
		url: string;
		fileSize?: number | null;
		filename?: string | null;
		isPrimary?: boolean;
	},
) {
	const id = crypto.randomUUID();
	await db.insert(mediaItems).values({
		id,
		resourceId: data.resourceId,
		type: data.type,
		mimeType: data.mimeType ?? null,
		url: data.url,
		fileSize: data.fileSize ?? null,
		filename: data.filename ?? null,
		isPrimary: data.isPrimary ?? false,
	});
	return { id };
}

export async function deleteMediaItem(db: DrizzleDB, id: string) {
	await db.delete(mediaItems).where(eq(mediaItems.id, id));
}
