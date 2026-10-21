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
 * La colección no se inspecciona: la política vigente es que cualquier curator
 * o admin puede gestionar cualquier colección, sin comprobar curatorId. El
 * parámetro se mantiene porque la firma la impone el contrato `canManage` de
 * crud-builder.ts (`(user, entity) => boolean`), que invoca esta función con la
 * entidad.
 */
export function canManageCollection(
	user: { id: string; role?: string },
	_collection: { curatorId?: string | null },
) {
	if (hasMinRole(user.role, "admin")) return true;
	if (hasMinRole(user.role, "curator")) {
		return true;
	}
	return false;
}
