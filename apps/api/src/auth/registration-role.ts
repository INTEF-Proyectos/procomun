/**
 * Rol de las cuentas nuevas creadas mediante el registro (#515).
 *
 * Better Auth da de alta usuarios en tres sitios: el registro con email y
 * contraseña (`/sign-up/email`), el primer inicio de sesión OIDC
 * (`/callback/:id`) y el alta de su plugin admin (`/admin/create-user`). Los
 * dos primeros son registro y la cuenta nace siempre como `editor`, traiga lo
 * que traiga la petición o el perfil del proveedor. El alta del plugin admin no
 * es registro: conserva el rol que elige el administrador.
 *
 * El alta desde el backoffice (`POST /api/admin/users`), la CLI y el importador
 * legacy escriben en la base de datos sin pasar por Better Auth, así que esta
 * regla no les afecta.
 */
export const REGISTRATION_ROLE = "editor";

/** Endpoints de Better Auth en los que un administrador elige el rol. */
const ADMIN_USER_CREATION_PATHS: readonly string[] = ["/admin/create-user"];

export function resolveNewUserRole(
	requestedRole: unknown,
	endpointPath: string | undefined,
): string {
	if (
		endpointPath !== undefined &&
		ADMIN_USER_CREATION_PATHS.includes(endpointPath) &&
		typeof requestedRole === "string" &&
		requestedRole.length > 0
	) {
		return requestedRole;
	}
	return REGISTRATION_ROLE;
}
