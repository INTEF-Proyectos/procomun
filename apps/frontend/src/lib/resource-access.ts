import { canManageResource } from "@procomun/db/validation";

type AccessUser = { id: string; role?: string | null };
type AccessResource = {
	createdBy?: string | null;
	assignedCuratorId?: string | null;
	editorialStatus?: string | null;
};

/**
 * ¿Sigue pudiendo abrir la edición quien cambia el estado? El servidor anota
 * como curator asignado a quien hace el cambio (updateEditorialStatus). Un
 * curator que devuelve a borrador un recurso ajeno lo pierde (#460): en vez de
 * recargar la página, hay que sacarlo de ella.
 */
export function keepsAccessAfterStatusChange(
	user: AccessUser,
	resource: AccessResource,
	newStatus: string,
): boolean {
	return canManageResource(user, {
		...resource,
		editorialStatus: newStatus,
		assignedCuratorId: user.id,
	});
}
