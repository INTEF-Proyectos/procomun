// Se importa cada mensaje por su módulo y no el barrel `messages.js`: ese
// barrel reexporta los casi 300 mensajes generados, y este fichero lo carga la
// suite de cobertura, que solo recorre los `.ts` (los `.tsx` de las islas van
// en `test:ui`, que no mide cobertura). Con el barrel, esos 300 módulos
// generados entran en el denominador sin que los llame nadie y la cobertura
// baja del 91 % al 49 %.
import { role_admin } from "../paraglide/messages/role_admin.js";
import { role_author } from "../paraglide/messages/role_author.js";
import { role_curator } from "../paraglide/messages/role_curator.js";
import { role_editor } from "../paraglide/messages/role_editor.js";
import { role_reader } from "../paraglide/messages/role_reader.js";

/**
 * Etiqueta traducida de un rol (#534). La insignia del perfil pintaba
 * `user.role` en crudo y se veía la clave sin traducir («AUTHOR»). Un rol
 * desconocido o ausente se trata como `reader`, igual que `hasMinRole`.
 */
const ROLE_LABELS: Record<string, () => string> = {
	reader: role_reader,
	author: role_author,
	editor: role_editor,
	curator: role_curator,
	admin: role_admin,
};

export function roleLabel(role: string | null | undefined): string {
	return (ROLE_LABELS[role ?? "reader"] ?? role_reader)();
}
