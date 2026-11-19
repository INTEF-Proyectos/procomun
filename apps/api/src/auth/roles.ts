import { canManageResource, hasMinRole } from "@procomun/db/validation";
import type { Context } from "hono";
import type { AuthEnv } from "./middleware.ts";

// Viven en @procomun/db para que el frontend use las mismas reglas y no
// ofrezca acciones que la API rechaza (#399).
export { canManageResource, hasMinRole };

export function getCurrentUser(c: Context<AuthEnv>) {
	return c.get("user") as {
		id: string;
		role?: string;
		name?: string;
		email?: string;
	};
}

/**
 * Quién gestiona una colección. El admin, cualquiera. El curator, las suyas y
 * las que no están en borrador: la cola de curación (revisión), las publicadas
 * y las archivadas.
 *
 * Issue #538: un borrador es trabajo de quien lo crea y no lo ve otro curator,
 * la misma regla que `canManageResource`/`isOthersPrivateDraft` aplica a los
 * recursos desde #460. En las colecciones el dueño es `curatorId`.
 * `listCollections({ hideOthersDraftsFor })` la aplica en SQL para que el
 * listado y esta comprobación no se desalineen.
 */
export function canManageCollection(
	user: { id: string; role?: string },
	collection: { curatorId?: string | null; editorialStatus?: string | null },
) {
	if (hasMinRole(user.role, "admin")) return true;
	if (hasMinRole(user.role, "curator")) {
		return !isOthersPrivateCollectionDraft(user, collection);
	}
	// #432: los itinerarios importados conservan a su autor como propietario,
	// aunque sea author o editor. Gestiona la suya en cualquier estado, como el
	// creador de un recurso (`canManageResource`). Crear, borrar y publicar
	// siguen siendo del curator: ver las rutas de colecciones y
	// `collectionStatusChangeError`.
	if (hasMinRole(user.role, "author")) {
		return collection.curatorId === user.id;
	}
	return false;
}

/**
 * #432: el propietario que no es curator edita el contenido de su colección,
 * pero el estado editorial es del curator: solo puede mandar su borrador a
 * revisión, igual que el autor de un recurso. Publicar, archivar o devolver a
 * borrador lo hace el curator desde la cola. Devuelve el error, o null.
 */
export function collectionStatusChangeError(
	user: { role?: string },
	from: string,
	to: string | undefined,
): string | null {
	if (to === undefined || to === from) return null;
	if (hasMinRole(user.role, "curator")) return null;
	if (from === "draft" && to === "review") return null;
	return `Solo un curator puede cambiar el estado de una colección de ${from} a ${to}`;
}

/** Borrador de colección de otra persona (#538). */
export function isOthersPrivateCollectionDraft(
	user: { id: string },
	collection: { curatorId?: string | null; editorialStatus?: string | null },
) {
	return (
		collection.editorialStatus === "draft" && collection.curatorId !== user.id
	);
}
