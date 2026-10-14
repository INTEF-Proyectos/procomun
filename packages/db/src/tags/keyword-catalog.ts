/**
 * Catálogo controlado de palabras clave (issue #384, ADR-0042).
 * Funciones puras, compartidas por la API y el frontend. Los 50 términos
 * iniciales se siembran por SQL (setup.ts y migración 0010_keyword_catalog).
 */

export const MAX_KEYWORD_SELECTIONS = 5;

export const KEYWORD_MESSAGES = {
	max: "Puedes seleccionar un máximo de 5 palabras clave. Elimina una para añadir otra",
	help: "Escribe para buscar y selecciona hasta 5 palabras clave del catálogo",
	empty:
		"No se han encontrado coincidencias. Prueba con un término más general",
	guidance:
		"Antes de crear una palabra clave, comprueba si existe otra equivalente. Utiliza una denominación general, clara y útil para otros recursos",
} as const;

export type KeywordCatalogEntry = {
	id: string;
	slug: string;
	label: string;
	aliases: string[];
};

export type KeywordSuggestion = {
	id: string;
	slug: string;
	label: string;
	/** `tag`: etiqueta libre anterior, solo en el filtro del buscador. */
	match: "label" | "alias" | "tag";
};

/** Ignora mayúsculas, tildes, almohadillas y espacios sobrantes. */
export function normalizeKeywordKey(value: string): string {
	return value
		.replace(/#/g, "")
		.trim()
		.replace(/\s+/g, " ")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "");
}

function textRank(query: string, value: string): number | null {
	if (!query || !value) return null;
	if (value === query) return 0;
	if (value.startsWith(query)) return 1;
	if (query.length >= 3) {
		if (value.split(" ").some((word) => word.startsWith(query))) return 2;
		if (query.includes(" ") && value.includes(query)) return 2;
	}
	return null;
}

/**
 * Busca en el catálogo. Las coincidencias de denominación van antes que las
 * de alias. Un alias ambiguo devuelve todas las opciones, sin elegir una.
 */
export function searchKeywordCatalog(
	query: string,
	catalog: readonly KeywordCatalogEntry[],
): KeywordSuggestion[] {
	const normalizedQuery = normalizeKeywordKey(query);
	if (!normalizedQuery) return [];

	const ranked: Array<KeywordSuggestion & { rank: number }> = [];
	for (const { id, slug, label, aliases } of catalog) {
		const labelRank = textRank(normalizedQuery, normalizeKeywordKey(label));
		if (labelRank !== null) {
			ranked.push({ id, slug, label, match: "label", rank: labelRank });
			continue;
		}
		const aliasRanks = aliases
			.map((alias) => textRank(normalizedQuery, normalizeKeywordKey(alias)))
			.filter((rank): rank is number => rank !== null);
		if (aliasRanks.length > 0) {
			ranked.push({
				id,
				slug,
				label,
				match: "alias",
				rank: 10 + Math.min(...aliasRanks),
			});
		}
	}

	ranked.sort(
		(a, b) => a.rank - b.rank || a.label.localeCompare(b.label, "es"),
	);
	return ranked.map(({ id, slug, label, match }) => ({
		id,
		slug,
		label,
		match,
	}));
}

/** Forma de la selección: lista de ids, sin duplicados y como máximo 5. */
export function validateKeywordSelection(
	ids: unknown,
): { ok: true; ids: string[] } | { ok: false; message: string } {
	if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
		return {
			ok: false,
			message: "keywordIds debe ser una lista de identificadores",
		};
	}
	if (new Set(ids).size !== ids.length) {
		return {
			ok: false,
			message: "No se admiten palabras clave duplicadas en el mismo recurso",
		};
	}
	if (ids.length > MAX_KEYWORD_SELECTIONS) {
		return { ok: false, message: KEYWORD_MESSAGES.max };
	}
	return { ok: true, ids };
}
