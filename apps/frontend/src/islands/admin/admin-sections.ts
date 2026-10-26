import { ROLE_LEVELS } from "../../lib/shared-utils.ts";
import type { AdminSection } from "./AdminPageIsland.tsx";

/** Nivel de rol mínimo requerido por cada sección del backoffice. */
export const SECTION_MIN_ROLE: Record<AdminSection, number> = {
	dashboard: ROLE_LEVELS.curator,
	resources: ROLE_LEVELS.curator,
	collections: ROLE_LEVELS.curator,
	categories: ROLE_LEVELS.curator,
	"knowledge-areas": ROLE_LEVELS.curator,
	tags: ROLE_LEVELS.curator,
	reports: ROLE_LEVELS.curator,
	users: ROLE_LEVELS.admin,
	"api-tokens": ROLE_LEVELS.admin,
};

export function isAdminSection(
	value: string | null | undefined,
): value is AdminSection {
	return value != null && value in SECTION_MIN_ROLE;
}

/**
 * Resuelve la sección a mostrar a partir de la solicitada (por ejemplo, desde la
 * URL) y el nivel de rol del usuario. Si la sección no existe o el usuario no tiene
 * privilegios suficientes (DEF-021), se deniega el acceso devolviendo "dashboard"
 * en lugar de mostrar un panel en blanco.
 */
export function resolveAdminSection(
	requested: string | null | undefined,
	userLevel: number,
): AdminSection {
	if (isAdminSection(requested) && userLevel >= SECTION_MIN_ROLE[requested]) {
		return requested;
	}
	return "dashboard";
}
