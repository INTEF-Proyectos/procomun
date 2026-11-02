import type { KnowledgeAreaRecord } from "../../lib/api-client.ts";

export type KnowledgeAreaStatusFilter = "all" | "active" | "inactive";

/** Sin mayúsculas ni tildes, como la comprobación de duplicados del servidor. */
export function foldKnowledgeAreaText(value: string): string {
	return value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Filtro del panel: texto (denominación o descripción), bloque y estado. */
export function filterKnowledgeAreas(
	areas: readonly KnowledgeAreaRecord[],
	filters: { q: string; blockId: string; status: KnowledgeAreaStatusFilter },
): KnowledgeAreaRecord[] {
	const q = foldKnowledgeAreaText(filters.q);
	return areas.filter((area) => {
		if (filters.blockId && area.blockId !== filters.blockId) return false;
		if (filters.status === "active" && !area.active) return false;
		if (filters.status === "inactive" && area.active) return false;
		if (!q) return true;
		return foldKnowledgeAreaText(
			`${area.label} ${area.description ?? ""}`,
		).includes(q);
	});
}

/** Mensaje de error de una respuesta `{ error }` del servidor. */
export function knowledgeAreaErrorMessage(
	err: unknown,
	fallback: string,
): string {
	return err && typeof err === "object" && "error" in err
		? String((err as { error: unknown }).error)
		: fallback;
}
