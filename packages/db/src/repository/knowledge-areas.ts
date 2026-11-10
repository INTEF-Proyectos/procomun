import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
	KEYWORD_AREA_REVIEW_CANDIDATES,
	KNOWLEDGE_AREA_BLOCKS,
	KNOWLEDGE_AREA_FIELD,
	KNOWLEDGE_AREA_MESSAGES,
	type KnowledgeAreaInput,
	normalizeKnowledgeAreaKey,
	PROFESSIONAL_FAMILIES,
	PROFESSIONAL_FAMILY_CATEGORY_ID,
	PROFESSIONAL_FAMILY_FIELD,
	type ProfessionalFamily,
	validateKnowledgeAreaInput,
	validateKnowledgeAreaSelection,
	validateProfessionalFamilySelection,
} from "../knowledge-areas.ts";
import {
	knowledgeAreas,
	resourceKnowledgeAreas,
	resourceProfessionalFamilies,
} from "../schema/knowledge-areas.ts";
import { resourceEducationalAreas } from "../schema/resources.ts";
import { resourceTags, tags } from "../schema/tags.ts";
import { tagSlugFromLabel } from "../tags/normalize.ts";
import type { DrizzleDB } from "./shared.ts";

export interface KnowledgeAreaRecord {
	id: string;
	label: string;
	description: string | null;
	blockId: string;
	position: number;
	active: boolean;
	/** Recursos asociados, también los no publicados. */
	usageCount: number;
}

export type ResourceKnowledgeArea = Pick<
	KnowledgeAreaRecord,
	"id" | "label" | "blockId" | "active"
>;

type AreaResult =
	| { status: "invalid"; message: string }
	| { status: "not_found" }
	| { status: "duplicate"; area: KnowledgeAreaRecord }
	| { status: "created" | "updated"; area: KnowledgeAreaRecord };

const BLOCK_ORDER = new Map(
	KNOWLEDGE_AREA_BLOCKS.map((block, index) => [block.id, index]),
);

/** Error que las rutas CRUD devuelven como 400 con el campo afectado. */
function badRequest(message: string, field?: string): Error {
	return Object.assign(new Error(message), { status: 400, field });
}

const usageCountSql = sql<number>`(select count(*)::int from resource_knowledge_areas rka where rka.area_id = ${knowledgeAreas.id})`;

/**
 * Catálogo de áreas en el orden de los bloques y, dentro de cada uno, por
 * posición y denominación. Sin `includeInactive` solo devuelve las activas
 * (las que se ofrecen para nuevas selecciones).
 */
export async function listKnowledgeAreas(
	db: DrizzleDB,
	opts: { includeInactive?: boolean } = {},
): Promise<KnowledgeAreaRecord[]> {
	const rows = await db
		.select({
			id: knowledgeAreas.id,
			label: knowledgeAreas.label,
			description: knowledgeAreas.description,
			blockId: knowledgeAreas.blockId,
			position: knowledgeAreas.position,
			active: knowledgeAreas.active,
			usageCount: usageCountSql,
		})
		.from(knowledgeAreas)
		.where(opts.includeInactive ? undefined : eq(knowledgeAreas.active, true))
		.orderBy(asc(knowledgeAreas.position), asc(knowledgeAreas.label));
	return rows
		.map((row) => ({ ...row, usageCount: Number(row.usageCount) }))
		.sort(
			(a, b) =>
				(BLOCK_ORDER.get(a.blockId) ?? 99) - (BLOCK_ORDER.get(b.blockId) ?? 99),
		);
}

export async function getKnowledgeArea(
	db: DrizzleDB,
	id: string,
): Promise<KnowledgeAreaRecord | null> {
	const [row] = await db
		.select({
			id: knowledgeAreas.id,
			label: knowledgeAreas.label,
			description: knowledgeAreas.description,
			blockId: knowledgeAreas.blockId,
			position: knowledgeAreas.position,
			active: knowledgeAreas.active,
			usageCount: usageCountSql,
		})
		.from(knowledgeAreas)
		.where(eq(knowledgeAreas.id, id));
	return row ? { ...row, usageCount: Number(row.usageCount) } : null;
}

/** Área con la misma denominación normalizada, activa o no, salvo `exceptId`. */
async function findAreaByLabel(
	db: DrizzleDB,
	label: string,
	exceptId?: string,
): Promise<KnowledgeAreaRecord | null> {
	const key = normalizeKnowledgeAreaKey(label);
	const match = (await listKnowledgeAreas(db, { includeInactive: true })).find(
		(area) =>
			area.id !== exceptId && normalizeKnowledgeAreaKey(area.label) === key,
	);
	return match ?? null;
}

async function allocateAreaId(db: DrizzleDB, label: string): Promise<string> {
	const base = tagSlugFromLabel(label);
	for (let suffix = 1; ; suffix++) {
		const candidate = suffix === 1 ? base : `${base}-${suffix}`;
		const [taken] = await db
			.select({ id: knowledgeAreas.id })
			.from(knowledgeAreas)
			.where(eq(knowledgeAreas.id, candidate));
		if (!taken) return candidate;
	}
}

/**
 * Alta de un área (admin/curator). El id sale de la denominación y no cambia
 * después. Rechaza una denominación normalizada repetida, también frente a
 * áreas desactivadas; el índice único cubre dos altas simultáneas.
 */
export async function createKnowledgeArea(
	db: DrizzleDB,
	input: KnowledgeAreaInput & { createdBy: string },
): Promise<AreaResult> {
	const parsed = validateKnowledgeAreaInput(input);
	if (!parsed.ok) return { status: "invalid", message: parsed.message };
	const {
		label,
		description = null,
		blockId,
	} = parsed.value as {
		label: string;
		description?: string | null;
		blockId: string;
	};

	const existing = await findAreaByLabel(db, label);
	if (existing) return { status: "duplicate", area: existing };

	const [last] = await db
		.select({
			position: sql<number>`coalesce(max(${knowledgeAreas.position}), -1)`,
		})
		.from(knowledgeAreas);
	const id = await allocateAreaId(db, label);
	const inserted = await db
		.insert(knowledgeAreas)
		.values({
			id,
			label,
			description,
			blockId,
			position: Number(last?.position ?? -1) + 1,
			createdBy: input.createdBy,
		})
		.onConflictDoNothing()
		.returning({ id: knowledgeAreas.id });
	if (inserted.length === 0) {
		const raced = await findAreaByLabel(db, label);
		if (!raced) throw new Error("No se pudo crear el área de conocimiento");
		return { status: "duplicate", area: raced };
	}
	const area = await getKnowledgeArea(db, id);
	if (!area) throw new Error("No se pudo crear el área de conocimiento");
	return { status: "created", area };
}

/**
 * Edita denominación, descripción, bloque o estado. El id se conserva, así
 * que las asociaciones con recursos no cambian. Desactivar no borra nada.
 */
export async function updateKnowledgeArea(
	db: DrizzleDB,
	id: string,
	input: KnowledgeAreaInput & { active?: unknown },
): Promise<AreaResult> {
	const current = await getKnowledgeArea(db, id);
	if (!current) return { status: "not_found" };
	const parsed = validateKnowledgeAreaInput(input, true);
	if (!parsed.ok) return { status: "invalid", message: parsed.message };
	if (input.active !== undefined && typeof input.active !== "boolean") {
		return {
			status: "invalid",
			message: "El estado debe ser verdadero o falso",
		};
	}

	if (parsed.value.label !== undefined) {
		const existing = await findAreaByLabel(db, parsed.value.label, id);
		if (existing) return { status: "duplicate", area: existing };
	}

	const changes = {
		...parsed.value,
		...(input.active === undefined ? {} : { active: input.active as boolean }),
	};
	if (Object.keys(changes).length > 0) {
		await db
			.update(knowledgeAreas)
			.set({ ...changes, updatedAt: new Date() })
			.where(eq(knowledgeAreas.id, id));
	}
	const area = await getKnowledgeArea(db, id);
	if (!area) return { status: "not_found" };
	return { status: "updated", area };
}

/** Áreas de un recurso, también las desactivadas (se marcan en edición). */
export async function listResourceKnowledgeAreas(
	db: DrizzleDB,
	resourceId: string,
): Promise<ResourceKnowledgeArea[]> {
	return db
		.select({
			id: knowledgeAreas.id,
			label: knowledgeAreas.label,
			blockId: knowledgeAreas.blockId,
			active: knowledgeAreas.active,
		})
		.from(resourceKnowledgeAreas)
		.innerJoin(
			knowledgeAreas,
			eq(resourceKnowledgeAreas.areaId, knowledgeAreas.id),
		)
		.where(eq(resourceKnowledgeAreas.resourceId, resourceId))
		.orderBy(asc(knowledgeAreas.label));
}

async function currentResourceAreaIds(
	db: DrizzleDB,
	resourceId: string | null,
): Promise<string[]> {
	if (!resourceId) return [];
	return (await listResourceKnowledgeAreas(db, resourceId)).map(
		(area) => area.id,
	);
}

/**
 * Valida una selección de áreas sin escribir nada: como máximo 3, del
 * catálogo y activas, salvo las desactivadas que el recurso ya tenía (en un
 * alta, `resourceId` es null y no vale ninguna). Lanza un Error con
 * `status: 400` y `field`.
 */
export async function assertResourceKnowledgeAreaIds(
	db: DrizzleDB,
	resourceId: string | null,
	areaIds: unknown,
): Promise<string[]> {
	const selection = validateKnowledgeAreaSelection(areaIds);
	if (!selection.ok) throw badRequest(selection.message, KNOWLEDGE_AREA_FIELD);
	if (selection.ids.length === 0) return [];
	const current = await currentResourceAreaIds(db, resourceId);
	const found = await db
		.select({ id: knowledgeAreas.id, active: knowledgeAreas.active })
		.from(knowledgeAreas)
		.where(inArray(knowledgeAreas.id, selection.ids));
	if (found.length !== selection.ids.length) {
		throw badRequest(KNOWLEDGE_AREA_MESSAGES.unknownArea, KNOWLEDGE_AREA_FIELD);
	}
	if (found.some((area) => !area.active && !current.includes(area.id))) {
		throw badRequest(
			KNOWLEDGE_AREA_MESSAGES.inactiveArea,
			KNOWLEDGE_AREA_FIELD,
		);
	}
	return selection.ids;
}

/**
 * Sustituye las áreas del recurso (máximo 3). Un área desactivada solo se
 * acepta si el recurso ya la tenía. Lanza un Error con `status: 400`.
 */
export async function setResourceKnowledgeAreas(
	db: DrizzleDB,
	resourceId: string,
	areaIds: unknown,
): Promise<void> {
	const ids = await assertResourceKnowledgeAreaIds(db, resourceId, areaIds);
	await writeResourceKnowledgeAreas(db, resourceId, ids);
}

/** Escribe una selección ya validada con {@link assertResourceKnowledgeAreaIds}. */
export async function writeResourceKnowledgeAreas(
	db: DrizzleDB,
	resourceId: string,
	areaIds: readonly string[],
): Promise<void> {
	const current = await currentResourceAreaIds(db, resourceId);
	const toRemove = current.filter((id) => !areaIds.includes(id));
	const toAdd = areaIds.filter((id) => !current.includes(id));
	if (toRemove.length > 0) {
		await db
			.delete(resourceKnowledgeAreas)
			.where(
				and(
					eq(resourceKnowledgeAreas.resourceId, resourceId),
					inArray(resourceKnowledgeAreas.areaId, toRemove),
				),
			);
	}
	if (toAdd.length > 0) {
		await db
			.insert(resourceKnowledgeAreas)
			.values(toAdd.map((areaId) => ({ resourceId, areaId })))
			.onConflictDoNothing();
	}
}

export async function listResourceProfessionalFamilies(
	db: DrizzleDB,
	resourceId: string,
): Promise<string[]> {
	const rows = await db
		.select({ familyId: resourceProfessionalFamilies.familyId })
		.from(resourceProfessionalFamilies)
		.where(eq(resourceProfessionalFamilies.resourceId, resourceId))
		.orderBy(asc(resourceProfessionalFamilies.familyId));
	return rows.map((row) => row.familyId);
}

/** Familias del recurso con su denominación, en el orden de la lista oficial. */
export async function listResourceProfessionalFamilyRecords(
	db: DrizzleDB,
	resourceId: string,
): Promise<ProfessionalFamily[]> {
	const ids = new Set(await listResourceProfessionalFamilies(db, resourceId));
	return PROFESSIONAL_FAMILIES.filter((family) => ids.has(family.id)).map(
		(family) => ({ ...family }),
	);
}

async function storedCategoryIds(
	db: DrizzleDB,
	resourceId: string,
): Promise<string[]> {
	const rows = await db
		.select({ categoryId: resourceEducationalAreas.categoryId })
		.from(resourceEducationalAreas)
		.where(eq(resourceEducationalAreas.resourceId, resourceId));
	return rows.map((row) => row.categoryId);
}

/**
 * Familias que hay que guardar en un alta o una edición, sin escribir nada.
 * Se cruzan con FP usando la categorización nueva si llega en la misma
 * petición (`categoryIds`) o, si no, con la guardada. Si la categorización
 * nueva quita FP, devuelve `[]` aunque no lleguen familias: un recurso que ya
 * no es de FP no conserva familias (#448). `undefined` = no se tocan.
 */
export async function resolveResourceProfessionalFamilies(
	db: DrizzleDB,
	resourceId: string | null,
	familyIds: unknown,
	categoryIds: readonly string[] | undefined,
): Promise<string[] | undefined> {
	if (familyIds === undefined) {
		if (categoryIds === undefined) return undefined;
		return categoryIds.includes(PROFESSIONAL_FAMILY_CATEGORY_ID)
			? undefined
			: [];
	}
	const categories =
		categoryIds ?? (resourceId ? await storedCategoryIds(db, resourceId) : []);
	const selection = validateProfessionalFamilySelection(familyIds, categories);
	if (!selection.ok) {
		throw badRequest(selection.message, PROFESSIONAL_FAMILY_FIELD);
	}
	return selection.ids;
}

/**
 * Sustituye las familias profesionales del recurso. Solo se admiten si el
 * recurso está clasificado en Formación Profesional (#380). Lanza un Error
 * con `status: 400`.
 */
export async function setResourceProfessionalFamilies(
	db: DrizzleDB,
	resourceId: string,
	familyIds: unknown,
): Promise<void> {
	// `null` en vez de `undefined`: aquí la lista es obligatoria.
	const ids = await resolveResourceProfessionalFamilies(
		db,
		resourceId,
		familyIds ?? null,
		undefined,
	);
	await writeResourceProfessionalFamilies(db, resourceId, ids ?? []);
}

/** Escribe una selección ya resuelta con {@link resolveResourceProfessionalFamilies}. */
export async function writeResourceProfessionalFamilies(
	db: DrizzleDB,
	resourceId: string,
	familyIds: readonly string[],
): Promise<void> {
	await db
		.delete(resourceProfessionalFamilies)
		.where(eq(resourceProfessionalFamilies.resourceId, resourceId));
	if (familyIds.length > 0) {
		await db
			.insert(resourceProfessionalFamilies)
			.values(familyIds.map((familyId) => ({ resourceId, familyId })));
	}
}

export interface KeywordAreaCrossingKeyword {
	id: string;
	label: string;
	retired: boolean;
	/** Recursos que tienen la palabra clave. */
	resources: number;
}

export interface KeywordAreaCrossing {
	/** Misma denominación normalizada que un área: se proponen para retirar. */
	identical: Array<{
		keyword: KeywordAreaCrossingKeyword;
		area: { id: string; label: string };
	}>;
	/** Parecidas a un área: decide producto (KEYWORD_AREA_REVIEW_CANDIDATES). */
	review: Array<{
		keyword: KeywordAreaCrossingKeyword;
		areas: Array<{ id: string; label: string }>;
	}>;
	/** Sin área equivalente: siguen como palabra clave (p. ej. Flamenco). */
	keep: KeywordAreaCrossingKeyword[];
}

/**
 * Cruza el catálogo de palabras clave con el de áreas (#384, #448). No
 * escribe nada: es la base del informe en seco y de la retirada.
 */
export async function crossKeywordCatalogWithAreas(
	db: DrizzleDB,
): Promise<KeywordAreaCrossing> {
	const keywords = await db
		.select({
			id: tags.id,
			label: tags.label,
			retiredAt: tags.retiredAt,
			resources: sql<number>`(select count(*)::int from ${resourceTags} rt where rt.tag_id = ${tags.id})`,
		})
		.from(tags)
		.where(and(eq(tags.catalog, true), isNull(tags.canonicalTagId)))
		.orderBy(asc(tags.label));
	const areas = await listKnowledgeAreas(db, { includeInactive: true });
	const areaByKey = new Map(
		areas.map((area) => [normalizeKnowledgeAreaKey(area.label), area]),
	);
	const areaById = new Map(areas.map((area) => [area.id, area]));

	const crossing: KeywordAreaCrossing = { identical: [], review: [], keep: [] };
	for (const row of keywords) {
		const keyword = {
			id: row.id,
			label: row.label,
			retired: row.retiredAt !== null,
			resources: Number(row.resources),
		};
		const area = areaByKey.get(normalizeKnowledgeAreaKey(row.label));
		if (area) {
			crossing.identical.push({
				keyword,
				area: { id: area.id, label: area.label },
			});
			continue;
		}
		const candidates = (KEYWORD_AREA_REVIEW_CANDIDATES[row.id] ?? [])
			.map((id) => areaById.get(id))
			.filter((candidate) => candidate !== undefined)
			.map((candidate) => ({ id: candidate.id, label: candidate.label }));
		if (candidates.length > 0) {
			crossing.review.push({ keyword, areas: candidates });
		} else {
			crossing.keep.push(keyword);
		}
	}
	return crossing;
}

/**
 * Retira términos del catálogo de palabras clave: dejan de ofrecerse, pero
 * los recursos que ya los tienen los conservan. Idempotente. Devuelve los ids
 * que se han retirado en esta llamada.
 */
export async function retireCatalogKeywords(
	db: DrizzleDB,
	keywordIds: readonly string[],
): Promise<string[]> {
	if (keywordIds.length === 0) return [];
	const rows = await db
		.update(tags)
		.set({ retiredAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				inArray(tags.id, [...keywordIds]),
				eq(tags.catalog, true),
				isNull(tags.retiredAt),
			),
		)
		.returning({ id: tags.id });
	return rows.map((row) => row.id);
}
