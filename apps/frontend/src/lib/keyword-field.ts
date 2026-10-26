import {
	KEYWORD_MESSAGES,
	MAX_KEYWORD_SELECTIONS,
} from "@procomun/db/keyword-catalog";
import type { CatalogKeyword } from "./api-client.ts";

/**
 * Añade una palabra clave elegida del catálogo. Escribir, pegar o pulsar
 * Intro sin una sugerencia resaltada no llegan aquí: nunca crean términos.
 * Devuelve la misma lista si no cambia.
 */
export function addKeyword(
	selected: CatalogKeyword[],
	keyword: CatalogKeyword,
): { selected: CatalogKeyword[]; message: string | null } {
	if (selected.some((item) => item.id === keyword.id)) {
		return { selected, message: null };
	}
	if (selected.length >= MAX_KEYWORD_SELECTIONS) {
		return { selected, message: KEYWORD_MESSAGES.max };
	}
	return { selected: [...selected, keyword], message: null };
}

export function keywordFieldNotice(input: {
	query: string;
	matchCount: number;
	selectedCount: number;
	canCreate: boolean;
	searching: boolean;
}): string | null {
	if (input.selectedCount >= MAX_KEYWORD_SELECTIONS)
		return KEYWORD_MESSAGES.max;
	if (!input.query.trim() || input.searching || input.matchCount > 0) {
		return null;
	}
	return input.canCreate ? KEYWORD_MESSAGES.guidance : KEYWORD_MESSAGES.empty;
}

export function moveHighlight(
	current: number,
	delta: number,
	length: number,
): number {
	if (length <= 0) return 0;
	return (current + delta + length) % length;
}
