import type {
	MyResourcesOptions,
	ResourceStatusCounts,
} from "../../lib/api-client.ts";
import { sanitizeEducationalFilter } from "../../lib/educational-classification.ts";
import { familyFilterFor } from "../../lib/knowledge-area-field.ts";
import "../../lib/paraglide-client.ts";
import * as m from "../../paraglide/messages.js";

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

export interface StatusFilterOption {
	value: MyResourcesStatus;
	label: string;
	count: number;
}

/** Opciones del filtro de estado con los contadores de la API. */
export function statusFilterOptions(
	counts: ResourceStatusCounts,
): StatusFilterOption[] {
	return [
		{
			value: "",
			count: counts.total,
			label: m.my_resources_status_all({ count: String(counts.total) }),
		},
		{
			value: "published",
			count: counts.published,
			label: m.my_resources_status_published({
				count: String(counts.published),
			}),
		},
		{
			value: "draft",
			count: counts.draft,
			label: m.my_resources_status_draft({ count: String(counts.draft) }),
		},
		{
			value: "review",
			count: counts.review,
			label: m.my_resources_status_review({ count: String(counts.review) }),
		},
		{
			value: "archived",
			count: counts.archived,
			label: m.my_resources_status_archived({
				count: String(counts.archived),
			}),
		},
	];
}

/** Insignia del estado en la tarjeta. Lo publicado no la necesita. */
export function statusBadge(
	status: string | undefined,
): { text: string; variant: "draft" | "review" | "tertiary" } | null {
	switch (status) {
		case "draft":
			return { text: m.resource_draft(), variant: "draft" };
		case "review":
			return { text: m.resource_in_review(), variant: "review" };
		case "archived":
			return { text: m.resource_archived(), variant: "tertiary" };
		default:
			return null;
	}
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
