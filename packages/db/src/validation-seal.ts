/**
 * Reglas del sello «Validado» (issue #420, ADR-0049 y su adenda 2026-11-16).
 *
 * El sello dice una sola cosa: un curator o un admin revisó el contenido que
 * se ve. Se guarda en `resources.validated_at` (más `validated_by` y
 * `validation_source`). Estas funciones son puras para que el servidor y el
 * frontend apliquen la misma regla.
 */
import { hasMinRole } from "./validation.ts";

export const VALIDATION_SOURCES = ["review", "legacy"] as const;
export type ValidationSource = (typeof VALIDATION_SOURCES)[number];

export type ValidationSealChange = "grant" | "revoke" | "keep";

/**
 * Qué le pasa al sello con un cambio de estado editorial.
 *
 * - `review → published` («Aprobar y publicar») lo pone. Solo pueden hacerlo
 *   curator y admin (TRANSITION_RULES).
 * - Publicar directamente desde borrador no lo pone, y quita el que hubiera
 *   quedado en el borrador por otra vía (por ejemplo, `--fix-published`).
 * - Archivar lo conserva (no se ve mientras está archivado).
 * - Volver a borrador o a revisión lo quita: el recurso tendrá que revisarse
 *   de nuevo.
 */
export function validationSealOnStatusChange(
	from: string,
	to: string,
): ValidationSealChange {
	if (from === "review" && to === "published") return "grant";
	if (from === "draft" || to === "draft" || to === "review") return "revoke";
	return "keep";
}

/**
 * Si una edición del contenido o de los metadatos públicos conserva el sello.
 * Curator y admin lo conservan; cualquier otro rol (en la práctica, el autor
 * del recurso) lo quita hasta que se revise de nuevo.
 */
export function keepsValidationOnEdit(role: string | null | undefined) {
	return hasMinRole(role, "curator");
}

/** Un recurso muestra el sello si está publicado y tiene fecha de validación. */
export function isResourceValidated(resource: {
	editorialStatus?: string | null;
	validatedAt?: Date | string | null;
}) {
	return (
		resource.editorialStatus === "published" &&
		resource.validatedAt != null &&
		resource.validatedAt !== ""
	);
}
