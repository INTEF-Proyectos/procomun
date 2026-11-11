import {
	normalizeKnowledgeAreaKey,
	PROFESSIONAL_FAMILY_CATEGORY_ID,
} from "@procomun/db/knowledge-areas";
import { url } from "./paths.ts";

/**
 * Lógica de los selectores de áreas de conocimiento y familias profesionales
 * (#448, ADR-0045), sin React: búsqueda, agrupación por bloques, máximo y la
 * relación de las familias con FP. La usan los formularios y el buscador.
 */

/** Opción de un catálogo: un área (con su bloque) o una familia. */
export interface CatalogOption {
	id: string;
	label: string;
	/** Bloque del área; las familias no tienen. */
	groupId?: string;
	/** `false` en un área desactivada que el recurso conserva. */
	active?: boolean;
}

export interface CatalogGroup {
	id: string;
	label: string;
}

export interface CatalogOptionGroup extends CatalogGroup {
	options: CatalogOption[];
}

/** Área tal como la sirve `GET /api/v1/knowledge-areas`. */
export interface CatalogArea {
	id: string;
	label: string;
	blockId: string;
	active: boolean;
}

function toOption(area: CatalogArea): CatalogOption {
	return {
		id: area.id,
		label: area.label,
		groupId: area.blockId,
		active: area.active,
	};
}

/** Todas las áreas como opciones (buscador: también las desactivadas). */
export function catalogAreaOptions(areas: CatalogArea[]): CatalogOption[] {
	return areas.map(toOption);
}

/**
 * Áreas que ofrece el formulario: las activas y, de las desactivadas, solo
 * las que el recurso ya tiene (se conservan al guardar, no se ofrecen a otros).
 */
export function formAreaOptions(
	areas: CatalogArea[],
	currentIds: readonly string[],
): CatalogOption[] {
	return areas
		.filter((area) => area.active || currentIds.includes(area.id))
		.map(toOption);
}

/**
 * Opciones que casan con lo escrito (sin mayúsculas, tildes ni espacios de
 * más), sin las ya elegidas, agrupadas en el orden de `groups` y sin grupos
 * vacíos. Sin `groups` devuelve una sola lista sin título.
 */
export function matchCatalogOptions(
	options: CatalogOption[],
	groups: CatalogGroup[] | undefined,
	{ query, excludeIds }: { query: string; excludeIds: readonly string[] },
): CatalogOptionGroup[] {
	const key = normalizeKnowledgeAreaKey(query);
	const matches = options.filter(
		(option) =>
			!excludeIds.includes(option.id) &&
			normalizeKnowledgeAreaKey(option.label).includes(key),
	);
	if (!groups) {
		return matches.length > 0 ? [{ id: "", label: "", options: matches }] : [];
	}
	return groups
		.map((group) => ({
			...group,
			options: matches.filter((option) => option.groupId === group.id),
		}))
		.filter((group) => group.options.length > 0);
}

/** Opciones en el orden de la lista, para moverse con las flechas. */
export function flattenOptionGroups(
	groups: CatalogOptionGroup[],
): CatalogOption[] {
	return groups.flatMap((group) => group.options);
}

/**
 * Las elegidas con su denominación. Si el catálogo no la tiene (no ha cargado
 * o el área ya no existe), se usa la que trae el recurso y, en último caso,
 * el id.
 */
export function selectedCatalogOptions(
	ids: readonly string[],
	options: CatalogOption[],
	fallback: CatalogOption[] = [],
): CatalogOption[] {
	return ids.map(
		(id) =>
			options.find((option) => option.id === id) ??
			fallback.find((option) => option.id === id) ?? { id, label: id },
	);
}

/** Añade una opción sin repetir; con `max`, avisa en vez de pasarse. */
export function addCatalogSelection(
	selected: string[],
	id: string,
	max?: number,
): { selected: string[]; limitReached: boolean } {
	if (selected.includes(id)) return { selected, limitReached: false };
	if (max !== undefined && selected.length >= max) {
		return { selected, limitReached: true };
	}
	return { selected: [...selected, id], limitReached: false };
}

/** La familia profesional solo se pide con Formación Profesional. */
export function showsProfessionalFamilies(
	categoryIds: readonly string[],
): boolean {
	return categoryIds.includes(PROFESSIONAL_FAMILY_CATEGORY_ID);
}

/** Familias elegidas que se perderán al guardar porque ya no hay FP. */
export function familiesPendingRemoval(
	categoryIds: readonly string[],
	familyIds: readonly string[],
): boolean {
	return familyIds.length > 0 && !showsProfessionalFamilies(categoryIds);
}

/** Lo que se envía al guardar: sin FP, ninguna familia. */
export function familiesToSave(
	categoryIds: readonly string[],
	familyIds: string[],
): string[] {
	return showsProfessionalFamilies(categoryIds) ? familyIds : [];
}

/** Enlace de la ficha al buscador filtrado por un área (no una búsqueda de texto). */
export function knowledgeAreaHref(areaId: string): string {
	return url(`explorar?knowledgeAreas=${encodeURIComponent(areaId)}`);
}

/** Enlace de la ficha al buscador filtrado por FP y una familia. */
export function professionalFamilyHref(familyId: string): string {
	return url(
		`explorar?educationalCategory=${PROFESSIONAL_FAMILY_CATEGORY_ID}&professionalFamilies=${encodeURIComponent(familyId)}`,
	);
}

/**
 * Filtro de familias del buscador: solo con la etapa FP elegida. Al quitar FP
 * (o al llegar en la URL sin ella) se limpia.
 */
export function familyFilterFor(
	educationalCategory: string | undefined,
	familyIds: string[] | undefined,
): string[] {
	return familiesToSave(
		educationalCategory ? [educationalCategory] : [],
		familyIds ?? [],
	);
}
