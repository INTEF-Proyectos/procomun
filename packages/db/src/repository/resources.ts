import {
	and,
	asc,
	desc,
	eq,
	isNotNull,
	isNull,
	ne,
	or,
	sql,
} from "drizzle-orm";
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
import type {
	ValidationSealChange,
	ValidationSource,
} from "../validation-seal.ts";
import {
	listResourceEducationalAreas,
	replaceResourceEducationalAreas,
} from "./educational-areas.ts";
import {
	assertCatalogKeywordIds,
	catalogLabelsSql,
	listResourceCatalogKeywords,
	setResourceCatalogKeywords,
} from "./keyword-catalog.ts";
import {
	assertResourceKnowledgeAreaIds,
	listResourceKnowledgeAreas,
	listResourceProfessionalFamilyRecords,
	resolveResourceProfessionalFamilies,
	writeResourceKnowledgeAreas,
	writeResourceProfessionalFamilies,
} from "./knowledge-areas.ts";
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
	/** Áreas de conocimiento (#448): recursos con cualquiera de ellas. */
	knowledgeAreaIds?: string[];
	/** Familias profesionales (#448): recursos con cualquiera de ellas. */
	professionalFamilyIds?: string[];
	createdBy?: string;
	visibleToUserId?: string;
	/**
	 * Oculta los borradores que no ha creado este usuario (#460). Es la versión
	 * SQL de `isOthersPrivateDraft` (validation.ts) para el listado del curator.
	 */
	hideOthersDraftsFor?: string;
	/** Orden descendente por fecha de alta (por defecto) o de edición (#530). */
	orderBy?: "createdAt" | "updatedAt";
	/**
	 * Busca solo en título, descripción y palabras clave, sin la autoría.
	 * Para «Mis recursos» (#530): todos son suyos y el autor suele ser su nombre.
	 */
	searchExcludesAuthorship?: boolean;
};

type ResourceMutationInput = {
	title: string;
	description: string;
	language: string;
	license: string;
	resourceType: string;
	keywords?: string;
	author?: string;
	otherAuthors?: string;
	publisher?: string;
	subjects?: string[];
	levels?: string[];
	/** Ids del catálogo de palabras clave (ADR-0042). */
	keywordIds?: unknown;
	educationalAreas?: unknown;
	/** Ids de `knowledge_areas` (#448, ADR-0045). */
	knowledgeAreaIds?: unknown;
	/** Ids de la lista oficial de familias; solo con FP. */
	professionalFamilyIds?: unknown;
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
	otherAuthors: resources.otherAuthors,
	publisher: resources.publisher,
	thumbnailUrl: resources.thumbnailUrl,
	createdBy: resources.createdBy,
	createdByName: user.name,
	/**
	 * La cuenta creadora existe y no está dada de baja (#541). Si no, su ficha
	 * de autor responde 404 y el frontend no enlaza su nombre.
	 */
	createdByActive: sql<boolean>`(${user.id} is not null and ${user.deletedAt} is null)`,
	editorialStatus: resources.editorialStatus,
	assignedCuratorId: resources.assignedCuratorId,
	curatedAt: resources.curatedAt,
	// Sello «Validado» (#420): la fecha y el origen, nunca quién lo dio.
	validatedAt: resources.validatedAt,
	validationSource: resources.validationSource,
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
	catalogLabels: catalogLabelsSql(resources.id),
};

const resourceDetailSelection = {
	...resourceBaseSelection,
	assignedCuratorId: resources.assignedCuratorId,
	curatedAt: resources.curatedAt,
};

async function listResourceTaxonomyValues(db: DrizzleDB, resourceId: string) {
	const [
		subjects,
		levels,
		catalogKeywords,
		educationalAreas,
		knowledgeAreas,
		professionalFamilies,
	] = await Promise.all([
		db
			.select({ subject: resourceSubjects.subject })
			.from(resourceSubjects)
			.where(eq(resourceSubjects.resourceId, resourceId)),
		db
			.select({ level: resourceLevels.level })
			.from(resourceLevels)
			.where(eq(resourceLevels.resourceId, resourceId)),
		listResourceCatalogKeywords(db, resourceId),
		listResourceEducationalAreas(db, resourceId),
		listResourceKnowledgeAreas(db, resourceId),
		listResourceProfessionalFamilyRecords(db, resourceId),
	]);

	return {
		subjects: subjects.map((subject: { subject: string }) => subject.subject),
		levels: levels.map((level: { level: string }) => level.level),
		catalogKeywords,
		educationalAreas,
		knowledgeAreas,
		professionalFamilies,
	};
}

/** `exists` sobre una tabla de relación: el recurso tiene alguno de los ids. */
function hasAnyRelatedId(table: "areas" | "families", ids: string[]) {
	const list = sql.join(
		ids.map((id) => sql`${id}`),
		sql`, `,
	);
	return table === "areas"
		? sql`exists (
				select 1 from resource_knowledge_areas rka
				where rka.resource_id = ${resources.id} and rka.area_id in (${list})
			)`
		: sql`exists (
				select 1 from resource_professional_families rpf
				where rpf.resource_id = ${resources.id} and rpf.family_id in (${list})
			)`;
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

/**
 * Condiciones del listado de recursos, compartidas por `listResources` y
 * `countResourcesByStatus` para que los contadores cuadren con la lista (#530).
 */
function resourceListConditions(opts: ResourceListOptions) {
	const conditions = [isNull(resources.deletedAt)];

	if (opts.search) {
		const term = buildSearchTerm(opts.search);
		// DEF-014: incluir el nombre del creador (user.name, mostrado como
		// "autor" en el listado) además del campo de texto libre `author`.
		// «Mis recursos» (#530) la excluye: buscar «ana» siendo Ana no filtraría.
		const fields = opts.searchExcludesAuthorship
			? [resources.title, resources.description, resources.keywords]
			: [
					resources.title,
					resources.description,
					resources.author,
					user.name,
					resources.keywords,
				];
		conditions.push(
			sql`(${sql.join(
				fields.map((field) => sql`${normalizeSearch(field)} LIKE ${term}`),
				sql` OR `,
			)})`,
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
	// #448: dentro de cada filtro vale cualquiera de los valores; entre
	// filtros (etapa, área, familia) se exigen todos.
	if (opts.knowledgeAreaIds?.length) {
		conditions.push(hasAnyRelatedId("areas", opts.knowledgeAreaIds));
	}
	if (opts.professionalFamilyIds?.length) {
		conditions.push(hasAnyRelatedId("families", opts.professionalFamilyIds));
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

	return conditions;
}

export async function listResources(db: DrizzleDB, opts: ResourceListOptions) {
	const { limit, offset } = normalizePagination(opts.limit, opts.offset);
	const where = andWhere(resourceListConditions(opts));
	// #530: «Mis recursos» enseña primero lo último editado.
	const orderColumn =
		opts.orderBy === "updatedAt" ? resources.updatedAt : resources.createdAt;
	const rows = await db
		.select(resourceListSelection)
		.from(resources)
		.leftJoin(user, eq(resources.createdBy, user.id))
		.where(where)
		.limit(limit)
		.offset(offset)
		.orderBy(desc(orderColumn), desc(resources.id));

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

export type ResourceStatusCounts = {
	draft: number;
	review: number;
	published: number;
	archived: number;
	total: number;
};

/**
 * Recursos por estado editorial con los mismos filtros que `listResources`
 * (el estado se ignora). Es lo que cuentan «Mis recursos» y el perfil (#530).
 */
export async function countResourcesByStatus(
	db: DrizzleDB,
	opts: Omit<ResourceListOptions, "status" | "limit" | "offset" | "orderBy">,
): Promise<ResourceStatusCounts> {
	const rows = await db
		.select({
			status: resources.editorialStatus,
			count: sql<number>`count(*)`,
		})
		.from(resources)
		.leftJoin(user, eq(resources.createdBy, user.id))
		.where(andWhere(resourceListConditions(opts)))
		.groupBy(resources.editorialStatus);

	const counts: ResourceStatusCounts = {
		draft: 0,
		review: 0,
		published: 0,
		archived: 0,
		total: 0,
	};
	for (const row of rows) {
		const count = Number(row.count ?? 0);
		counts.total += count;
		if (row.status && row.status in counts && row.status !== "total") {
			counts[row.status as Exclude<keyof ResourceStatusCounts, "total">] +=
				count;
		}
	}
	return counts;
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

// «Otros autores» es opcional: un texto vacío o solo con espacios se guarda
// como null para que la ficha no muestre la fila (issue #417).
function emptyToNull(value: string | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

export async function createResource(
	db: DrizzleDB,
	data: ResourceMutationInput,
) {
	// Antes de insertar: una selección inválida (400) no deja un recurso creado.
	if (data.keywordIds !== undefined) {
		await assertCatalogKeywordIds(db, data.keywordIds);
	}
	const educationalAreas =
		data.educationalAreas === undefined
			? undefined
			: normalizeEducationalAssignments(data.educationalAreas);
	// #448: un alta solo admite áreas activas, y familias si es de FP.
	const knowledgeAreaIds =
		data.knowledgeAreaIds === undefined
			? []
			: await assertResourceKnowledgeAreaIds(db, null, data.knowledgeAreaIds);
	const professionalFamilyIds =
		(await resolveResourceProfessionalFamilies(
			db,
			null,
			data.professionalFamilyIds,
			(educationalAreas ?? []).map((area) => area.categoryId),
		)) ?? [];
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
		otherAuthors: emptyToNull(data.otherAuthors),
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

	if (knowledgeAreaIds.length > 0) {
		await writeResourceKnowledgeAreas(db, id, knowledgeAreaIds);
	}
	if (professionalFamilyIds.length > 0) {
		await writeResourceProfessionalFamilies(db, id, professionalFamilyIds);
	}

	// Dual-write: free-text keywords → atomized tags (ADR-0034 / #76)
	if (data.keywords) {
		const { syncTagsFromKeywords } = await import("./tags.ts");
		await syncTagsFromKeywords(db, id, data.keywords);
	}

	if (data.keywordIds !== undefined) {
		await setResourceCatalogKeywords(db, id, data.keywordIds);
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
	"otherAuthors",
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

	// Las selecciones se validan antes de escribir nada: una inválida (400) no
	// deja el recurso a medias (#448).
	const knowledgeAreaIds =
		raw.knowledgeAreaIds === undefined
			? undefined
			: await assertResourceKnowledgeAreaIds(db, id, raw.knowledgeAreaIds);
	const professionalFamilyIds = await resolveResourceProfessionalFamilies(
		db,
		id,
		raw.professionalFamilyIds,
		educationalAreas?.map((area) => area.categoryId),
	);
	const { keywordIds } = data as { keywordIds?: unknown };
	if (keywordIds !== undefined) {
		await setResourceCatalogKeywords(db, id, keywordIds);
	}

	// Evita un UPDATE vacío si el cuerpo solo traía claves sensibles filtradas.
	if (
		Object.keys(safe).length === 0 &&
		!educationalAreas &&
		!knowledgeAreaIds &&
		!professionalFamilyIds
	) {
		return;
	}

	await db.transaction(async (tx: DrizzleDB) => {
		await tx
			.update(resources)
			.set({
				...safe,
				...("otherAuthors" in safe
					? { otherAuthors: emptyToNull(safe.otherAuthors) }
					: {}),
				updatedAt: new Date(),
			})
			.where(and(eq(resources.id, id), isNull(resources.deletedAt)));
		if (educationalAreas) {
			await replaceResourceEducationalAreas(tx, id, educationalAreas);
		}
		if (knowledgeAreaIds) {
			await writeResourceKnowledgeAreas(tx, id, knowledgeAreaIds);
		}
		if (professionalFamilyIds) {
			await writeResourceProfessionalFamilies(tx, id, professionalFamilyIds);
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
	options: { validationSeal?: ValidationSealChange } = {},
) {
	const now = new Date();
	const updates: Record<string, unknown> = {
		editorialStatus: status,
		assignedCuratorId: curatorId,
		updatedAt: now,
	};
	if (status === "published" || status === "archived") {
		updates.curatedAt = now;
	}
	// Sello «Validado» (#420): quien llama decide con
	// validationSealOnStatusChange; por defecto no se toca.
	if (options.validationSeal === "grant") {
		updates.validatedAt = now;
		updates.validatedBy = curatorId;
		updates.validationSource = "review" satisfies ValidationSource;
	} else if (options.validationSeal === "revoke") {
		Object.assign(updates, NO_VALIDATION);
	}

	await db
		.update(resources)
		.set(updates)
		.where(and(eq(resources.id, id), isNull(resources.deletedAt)));
}

/** Columnas del sello «Validado» (#420) vacías: el recurso deja de tenerlo. */
export const NO_VALIDATION = {
	validatedAt: null,
	validatedBy: null,
	validationSource: null,
};

/**
 * Quita el sello «Validado» (#420) tras un cambio del contenido o de los
 * metadatos públicos hecho por alguien que no es curator ni admin. Devuelve
 * true si el recurso lo tenía.
 */
export async function revokeResourceValidation(db: DrizzleDB, id: string) {
	const rows = await db
		.update(resources)
		.set(NO_VALIDATION)
		.where(and(eq(resources.id, id), isNotNull(resources.validatedAt)))
		.returning({ id: resources.id });
	return rows.length > 0;
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
