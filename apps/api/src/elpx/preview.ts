import { elpxPreviewUrlForStatus } from "./preview-token.ts";

/**
 * Vista previa del .elpx para la API. Los listados públicos solo traen
 * recursos publicados, así que por defecto se usa la URL estable. Quien pase
 * otro estado (la ficha de un borrador vista por su autora) recibe un enlace
 * firmado (issue #466).
 */
export function buildElpxPreview(
	elpx: { hash?: string; hasPreview?: boolean } | null | undefined,
	editorialStatus: string | null | undefined = "published",
): { hash: string; previewUrl: string } | null {
	if (!elpx?.hasPreview || !elpx.hash) return null;
	return {
		hash: elpx.hash,
		previewUrl: elpxPreviewUrlForStatus(elpx.hash, editorialStatus),
	};
}

export type ElpxRow = { resourceId: string; hash: string; hasPreview: boolean };

export function buildElpxMap(rows: ElpxRow[]): Map<string, ElpxRow> {
	return new Map(rows.map((row) => [row.resourceId, row]));
}
