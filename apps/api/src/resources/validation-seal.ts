import * as repo from "@procomun/db/repository";
import { keepsValidationOnEdit } from "@procomun/db/validation-seal";

type Db = Parameters<typeof repo.revokeResourceValidation>[0];

/**
 * Punto único de paso tras cambiar el contenido o los metadatos públicos de
 * un recurso (issue #420, ADR-0049): metadatos, `.elpx` nuevo, adjuntos y
 * etiquetas. Si quien edita no es curator ni admin, el recurso pierde el
 * sello «Validado» hasta que se revise de nuevo. Devuelve true si lo quitó.
 */
export async function onPublicContentChanged(
	db: Db,
	resourceId: string,
	actor: { role?: string | null },
) {
	if (keepsValidationOnEdit(actor.role)) return false;
	return repo.revokeResourceValidation(db, resourceId);
}
