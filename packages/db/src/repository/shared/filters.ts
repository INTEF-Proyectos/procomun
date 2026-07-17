import type { AnyColumn, SQL, SQLWrapper } from "drizzle-orm";
import { and, sql } from "drizzle-orm";

const ACCENTED_CHARACTERS = "áéíóúÁÉÍÓÚäëïöüÄËÏÖÜñÑ";
const NORMALIZED_CHARACTERS = "aeiouAEIOUaeiouAEIOUnN";

export function normalizeSearch(column: AnyColumn) {
	return sql`lower(translate(${column}, ${ACCENTED_CHARACTERS}, ${NORMALIZED_CHARACTERS}))`;
}

export function buildSearchTerm(value: string) {
	return `%${value
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")}%`;
}

export function normalizePagination(
	limit?: number,
	offset?: number,
	maxLimit = 100,
) {
	return {
		limit: Math.min(limit ?? 20, maxLimit),
		offset: offset ?? 0,
	};
}

/**
 * Combina condiciones SQL con AND. Devuelve `undefined` si no hay ninguna
 * (para que `.where(undefined)` no aplique filtro).
 */
export function optionalAndWhere(
	conditions: (SQLWrapper | undefined)[],
): SQL | undefined {
	const defined = conditions.filter(
		(condition): condition is SQLWrapper => condition !== undefined,
	);
	if (defined.length === 0) return undefined;
	return and(...defined);
}
