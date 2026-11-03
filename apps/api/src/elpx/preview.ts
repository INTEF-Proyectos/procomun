import { elpxPreviewUrlForStatus } from "./preview-token.ts";

export type ElpxPreview = {
	hash: string;
	previewUrl: string;
	/** Miniatura screenshot.png de eXeLearning 4 (#409), si el paquete la trae. */
	screenshotUrl: string | null;
};

/**
 * Los listados publicos usan la URL estable. Las rutas autorizadas que pasan
 * un estado no publicado reciben un enlace firmado tambien para la miniatura.
 */
export function buildElpxPreview(
	elpx:
		| { hash?: string; hasPreview?: boolean; hasScreenshot?: boolean }
		| null
		| undefined,
	editorialStatus: string | null | undefined = "published",
): ElpxPreview | null {
	if (!elpx?.hasPreview || !elpx.hash) return null;
	const previewUrl = elpxPreviewUrlForStatus(elpx.hash, editorialStatus);
	return {
		hash: elpx.hash,
		previewUrl,
		screenshotUrl: elpx.hasScreenshot ? `${previewUrl}screenshot.png` : null,
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
