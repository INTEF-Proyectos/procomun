import { ROLE_LEVELS } from "@procomun/db/validation";
import type { Context } from "hono";
import type { AuthEnv } from "./middleware.ts";

export function getCurrentUser(c: Context<AuthEnv>) {
	return c.get("user") as {
		id: string;
		role?: string;
		name?: string;
		email?: string;
	};
}

export function hasMinRole(
	role: string | undefined,
	minRole: keyof typeof ROLE_LEVELS,
) {
	return (ROLE_LEVELS[role ?? "reader"] ?? 0) >= (ROLE_LEVELS[minRole] ?? 0);
}

export function canManageResource(
	user: { id: string; role?: string },
	resource: {
		createdBy?: string | null;
		assignedCuratorId?: string | null;
		editorialStatus?: string | null;
	},
) {
	if (hasMinRole(user.role, "admin")) return true;
	// El creador siempre puede gestionar su propio recurso, en cualquier estado
	// (DEF-221: un curator que crea un recurso debe poder ver/editar su borrador).
	if (hasMinRole(user.role, "author") && resource.createdBy === user.id) {
		return true;
	}
	// Un curator gestiona la cola de curación (recursos en revisión) y, además,
	// cualquier recurso que él mismo haya curado. Al cambiar el estado de un recurso
	// desde "review" queda registrado como assignedCuratorId (ver updateEditorialStatus),
	// por lo que debe conservar el acceso aunque el recurso ya no esté en revisión
	// (DEF-009 / #205: antes pasaba a "recurso no encontrado" tras publicarlo/devolverlo a borrador).
	if (hasMinRole(user.role, "curator")) {
		return (
			resource.editorialStatus === "review" ||
			resource.assignedCuratorId === user.id
		);
	}
	return false;
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
