/**
 * Estado editorial de un recurso legacy según el campo `published` de su JSON
 * (issue #447, ADR-0029). Solo `1` (número o texto) se publica; `0`, un valor
 * ausente o uno desconocido se importan como borrador, para no publicar nunca
 * por accidente lo que el Procomún antiguo no tenía publicado.
 */
export type LegacyEditorialStatus = "published" | "draft";

export interface LegacyPublicationStatus {
	editorialStatus: LegacyEditorialStatus;
	/** Valor recibido en el JSON, para el informe; null si no era texto ni número. */
	sourcePublished: string | number | null;
	/** false si el valor no era 0 ni 1: el informe lo avisa. */
	recognized: boolean;
}

export function resolveLegacyPublicationStatus(
	value: unknown,
): LegacyPublicationStatus {
	const sourcePublished =
		typeof value === "string" || typeof value === "number" ? value : null;
	const normalized =
		typeof value === "string"
			? value.trim()
			: typeof value === "number"
				? String(value)
				: null;
	if (normalized === "1") {
		return { editorialStatus: "published", sourcePublished, recognized: true };
	}
	return {
		editorialStatus: "draft",
		sourcePublished,
		recognized: normalized === "0",
	};
}
