/**
 * Acceso a las miniaturas del almacén `storageDir/thumbnails/` según el estado
 * editorial (revisión de #481, adenda 2026-11-03 de ADR-0046): la preview
 * legacy (#472) y la miniatura generada (#470).
 *
 * Publicado: la URL estable `/api/v1/thumbnails/<fichero>`, que solo sirve el
 * fichero si pertenece a un recurso publicado. Cualquier otro estado: un
 * enlace firmado con el mismo mecanismo que la vista previa de #466, para que
 * quien no puede ver el recurso no vea tampoco su portada.
 */
import { canViewResource } from "@procomun/db/validation";
import { createSignedToken, verifySignedToken } from "../elpx/preview-token.ts";
import {
	THUMBNAIL_FILE_RE,
	THUMBNAIL_PUBLIC_PREFIX,
} from "../services/legacy-preview-image.ts";

export const THUMBNAIL_SIGNED_PREFIX = `${THUMBNAIL_PUBLIC_PREFIX}signed/`;

export function createThumbnailToken(
	file: string,
	nowMs: number = Date.now(),
	ttlSeconds?: number,
): string {
	return createSignedToken("thumbnail", file, nowMs, ttlSeconds);
}

export function verifyThumbnailToken(
	file: string,
	token: string,
	nowMs: number = Date.now(),
): boolean {
	return verifySignedToken("thumbnail", file, token, nowMs);
}

export function buildSignedThumbnailUrl(
	file: string,
	nowMs: number = Date.now(),
): string {
	return `${THUMBNAIL_SIGNED_PREFIX}${createThumbnailToken(file, nowMs)}/${file}`;
}

/**
 * URL de una miniatura según el estado del recurso. Llamar con un estado no
 * publicado solo desde rutas que ya han comprobado que el usuario puede ver el
 * recurso. Una URL externa (preview legacy aún sin copiar) no es nuestra y se
 * devuelve igual; una nuestra con un nombre que no es del almacén, null.
 */
export function thumbnailUrlForStatus(
	url: string | null | undefined,
	editorialStatus: string | null | undefined,
	nowMs: number = Date.now(),
): string | null {
	const value = url?.trim();
	if (!value) return null;
	if (!value.startsWith(THUMBNAIL_PUBLIC_PREFIX)) return value;
	const file = value.slice(THUMBNAIL_PUBLIC_PREFIX.length);
	if (!THUMBNAIL_FILE_RE.test(file)) return null;
	if (editorialStatus === "published") return value;
	return buildSignedThumbnailUrl(file, nowMs);
}

type ViewerRow = {
	thumbnailUrl?: string | null;
	editorialStatus?: string | null;
	createdBy?: string | null;
	assignedCuratorId?: string | null;
};

/**
 * Para listados que pueden traer recursos que el usuario no puede ver (por
 * ejemplo, un favorito que se archivó): null si no puede verlo.
 */
export function thumbnailUrlForViewer(
	row: ViewerRow,
	viewer: { id: string; role?: string | null } | null,
	nowMs: number = Date.now(),
): string | null {
	if (!canViewResource(viewer, row)) return null;
	return thumbnailUrlForStatus(row.thumbnailUrl, row.editorialStatus, nowMs);
}
