import { elpxPreviewUrlForStatus } from "./preview-token.ts";

/**
 * Lo que el .elpx ofrece a la ficha y a las tarjetas. El visor y la miniatura
 * son independientes (revisión de #471): un paquete puede traer screenshot.png
 * en la raíz sin index.html. Que `elpxPreview` no sea null no implica que haya
 * visor; para el iframe y «Ponlo en tu web» hay que mirar `previewUrl`.
 */
export type ElpxPreview = {
	hash: string;
	/** Visor HTML del paquete (index.html). `null` si el paquete no lo trae. */
	previewUrl: string | null;
	/** Miniatura screenshot.png de eXeLearning 4 (#409), si el paquete la trae. */
	screenshotUrl: string | null;
};

/**
 * Los listados publicos usan la URL estable. Las rutas autorizadas que pasan
 * un estado no publicado reciben un enlace firmado tambien para la miniatura.
 * Devuelve null solo si el paquete no tiene ni visor ni miniatura.
 */
export function buildElpxPreview(
	elpx:
		| { hash?: string; hasPreview?: boolean; hasScreenshot?: boolean }
		| null
		| undefined,
	editorialStatus: string | null | undefined = "published",
): ElpxPreview | null {
	if (!elpx?.hash) return null;
	const hasPreview = elpx.hasPreview === true;
	const hasScreenshot = elpx.hasScreenshot === true;
	if (!hasPreview && !hasScreenshot) return null;
	// La miniatura cuelga del mismo prefijo que el visor: la URL estable si está
	// publicado y el enlace firmado si no (#466, #483).
	const baseUrl = elpxPreviewUrlForStatus(elpx.hash, editorialStatus);
	return {
		hash: elpx.hash,
		previewUrl: hasPreview ? baseUrl : null,
		screenshotUrl: hasScreenshot ? `${baseUrl}screenshot.png` : null,
	};
}

export type ElpxRow = {
	resourceId: string;
	hash: string;
	hasPreview: boolean;
	hasScreenshot?: boolean;
};

export function buildElpxMap(rows: ElpxRow[]): Map<string, ElpxRow> {
	return new Map(rows.map((row) => [row.resourceId, row]));
}
