import * as m from "../paraglide/messages.js";

/**
 * Etiqueta traducida de un rol (#534). La insignia del perfil pintaba
 * `user.role` en crudo y se veía la clave sin traducir («AUTHOR»). Un rol
 * desconocido o ausente se trata como `reader`, igual que `hasMinRole`.
 */
const ROLE_LABELS: Record<string, () => string> = {
	reader: m.role_reader,
	author: m.role_author,
	editor: m.role_editor,
	curator: m.role_curator,
	admin: m.role_admin,
};

export function roleLabel(role: string | null | undefined): string {
	return (ROLE_LABELS[role ?? "reader"] ?? m.role_reader)();
}
