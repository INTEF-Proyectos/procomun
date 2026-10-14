import { ROLE_LEVELS, roleLevelOf } from "../lib/shared-utils.ts";

/** Etiqueta visible del botón en la pantalla de edición (issue #393). */
export const DELETE_ODE_BUTTON_LABEL = "Borrar ODE";

/**
 * Mismo umbral que la pantalla de edición para guardar: author o superior.
 * Un reader no llega a editar y tampoco ve esta acción.
 */
export function canShowDeleteOdeButton(input: {
	role?: string | null;
	hasOde: boolean;
}): boolean {
	return roleLevelOf(input.role) >= ROLE_LEVELS.author && input.hasOde;
}

/** Nombre que debe aparecer en la confirmación: archivo del ODE o, si falta, el título. */
export function deleteOdeDisplayName(input: {
	originalFilename?: string | null;
	resourceTitle?: string | null;
}): string {
	const filename = input.originalFilename?.trim();
	if (filename) return filename;
	const title = input.resourceTitle?.trim();
	if (title) return title;
	return "este ODE";
}

export function deleteOdeConfirmationMessage(input: {
	originalFilename?: string | null;
	resourceTitle?: string | null;
}): string {
	const name = deleteOdeDisplayName(input);
	return `¿Borrar el ODE «${name}»? Se retirará el paquete de este recurso. La ficha se conserva.`;
}
