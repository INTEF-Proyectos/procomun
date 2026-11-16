import type {
	MyResourcesOptions,
	ResourceStatusCounts,
} from "../../lib/api-client.ts";
import { sanitizeEducationalFilter } from "../../lib/educational-classification.ts";
import { familyFilterFor } from "../../lib/knowledge-area-field.ts";

/** Estados editoriales que se pueden filtrar en «Mis recursos»; vacío es «todos». */
export type MyResourcesStatus =
	| ""
	| "published"
	| "draft"
	| "review"
	| "archived";

export interface MyResourcesFilters {
	status: MyResourcesStatus;
	query: string;
	resourceType: string;
	tag: string;
	tagLabel: string;
	educationalCategory: string;
	educationalOption: string;
	knowledgeAreas: string[];
	professionalFamilies: string[];
}

export const EMPTY_MY_RESOURCES_FILTERS: MyResourcesFilters = {
	status: "",
	query: "",
	resourceType: "",
	tag: "",
	tagLabel: "",
	educationalCategory: "",
	educationalOption: "",
	knowledgeAreas: [],
	professionalFamilies: [],
};

export const EMPTY_STATUS_COUNTS: ResourceStatusCounts = {
	draft: 0,
	review: 0,
	published: 0,
	archived: 0,
	total: 0,
};

/** Múltiplo de 2, 3 y 4 para que la rejilla no deje huecos en la última fila. */
export const MY_RESOURCES_PAGE_SIZE = 12;

/** Petición a `GET /api/v1/users/me/resources` para unos filtros y una página. */
export function myResourcesRequest(
	filters: MyResourcesFilters,
	page: number,
): MyResourcesOptions {
	const educational = sanitizeEducationalFilter(
		filters.educationalCategory,
		filters.educationalOption,
	);
	const query = filters.query.trim();
	return {
		status: filters.status || undefined,
		q: query || undefined,
		limit: MY_RESOURCES_PAGE_SIZE,
		offset: (Math.max(1, page) - 1) * MY_RESOURCES_PAGE_SIZE,
		resourceType: filters.resourceType || undefined,
		tag: filters.tag || undefined,
		educationalCategory: educational.categoryId || undefined,
		educationalOption: educational.optionId || undefined,
		knowledgeAreas: filters.knowledgeAreas,
		// Las familias solo valen con la etapa Formación Profesional (#448).
		professionalFamilies: familyFilterFor(
			educational.categoryId,
			filters.professionalFamilies,
		),
	};
}

/** Hay búsqueda o filtros además del estado (para «Limpiar filtros»). */
export function hasActiveFilters(filters: MyResourcesFilters): boolean {
	return Boolean(
		filters.query.trim() ||
			filters.resourceType ||
			filters.tag ||
			filters.educationalCategory ||
			filters.knowledgeAreas.length ||
			filters.professionalFamilies.length,
	);
}

/** Tras borrar el único recurso de una página se vuelve a la anterior. */
export function pageAfterDelete(page: number, itemsOnPage: number): number {
	return itemsOnPage <= 1 && page > 1 ? page - 1 : page;
}
