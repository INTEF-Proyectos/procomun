import {
	THUMBNAIL_FILE_RE,
	THUMBNAIL_PUBLIC_PREFIX,
} from "../services/legacy-preview-image.ts";
import { elpxPreviewUrlForStatus } from "./preview-token.ts";

export type ElpxPreview = {
	hash: string;
	previewUrl: string;
	/** Miniatura screenshot.png de eXeLearning 4 (#409), si el paquete la trae. */
	screenshotUrl: string | null;
	/** Miniatura generada en el servidor (#470) para los paquetes sin imagen. */
	thumbnailUrl: string | null;
};

/** Solo un nombre del almacén: lo que venga de la base de datos no se interpola. */
function generatedThumbnailUrl(file: string | null | undefined): string | null {
	return file && THUMBNAIL_FILE_RE.test(file)
		? `${THUMBNAIL_PUBLIC_PREFIX}${file}`
		: null;
}

/**
 * Los listados publicos usan la URL estable. Las rutas autorizadas que pasan
 * un estado no publicado reciben un enlace firmado tambien para la miniatura.
 */
export function buildElpxPreview(
	elpx:
		| {
				hash?: string;
				hasPreview?: boolean;
				hasScreenshot?: boolean;
				thumbnailFile?: string | null;
		  }
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
		thumbnailUrl: generatedThumbnailUrl(elpx.thumbnailFile),
	};
}

export type ElpxRow = {
	resourceId: string;
	hash: string;
	hasPreview: boolean;
	hasScreenshot?: boolean;
	thumbnailFile?: string | null;
};

export function buildElpxMap(rows: ElpxRow[]): Map<string, ElpxRow> {
	return new Map(rows.map((row) => [row.resourceId, row]));
}
