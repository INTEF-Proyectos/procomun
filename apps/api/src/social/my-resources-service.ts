import * as repo from "@procomun/db/repository";
import { type EditorialStatus, VALID_STATUSES } from "@procomun/db/validation";
import { getDb } from "../db.ts";
import { enrichResourceCards } from "./resource-card.ts";

/** Filtros de «Mis recursos» (#530): los del buscador público más el estado. */
export interface MyResourcesQuery {
	limit: number;
	offset: number;
	status?: EditorialStatus;
	search?: string;
	resourceType?: string;
	tag?: string;
	educationalCategory?: string;
	educationalOption?: string;
	knowledgeAreaIds?: string[];
	professionalFamilyIds?: string[];
}

/** Estado del filtro: vacío es «todos»; un valor desconocido es un error. */
export function parseMyResourcesStatus(
	raw: string | undefined,
): { ok: true; status: EditorialStatus | undefined } | { ok: false } {
	if (!raw) return { ok: true, status: undefined };
	return (VALID_STATUSES as readonly string[]).includes(raw)
		? { ok: true, status: raw as EditorialStatus }
		: { ok: false };
}

/**
 * Recursos propios en cualquier estado, paginados y filtrados, con los
 * contadores por estado de esos mismos filtros para que cuadren con la lista.
 */
export async function listMyResources(userId: string, query: MyResourcesQuery) {
	const db = getDb().db;
	const filters = {
		createdBy: userId,
		search: query.search || undefined,
		resourceType: query.resourceType || undefined,
		tagSlug: query.tag || undefined,
		educationalCategory: query.educationalCategory || undefined,
		educationalOption: query.educationalOption || undefined,
		knowledgeAreaIds: query.knowledgeAreaIds,
		professionalFamilyIds: query.professionalFamilyIds,
	};
	const [page, statusCounts] = await Promise.all([
		repo.listResources(db, {
			...filters,
			status: query.status,
			limit: query.limit,
			offset: query.offset,
			orderBy: "updatedAt",
		}),
		repo.countResourcesByStatus(db, filters),
	]);
	return {
		...page,
		data: await enrichResourceCards(page.data),
		statusCounts,
	};
}
