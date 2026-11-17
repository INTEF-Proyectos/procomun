import { and, eq, isNull, ne, or } from "drizzle-orm";
import { normalizeLegacyPublicatorEmail } from "../legacy-import/publicator-email.ts";
import { LEGACY_IMPORT_SYSTEM_USER_ID } from "../legacy-import/system-user.ts";
import { lowerEmail, user } from "../schema/auth.ts";
import { resources } from "../schema/resources.ts";
import type { DrizzleDB } from "./shared.ts";

/**
 * Cuenta cuyo correo coincide con el `publicatorEmailStr` de un recurso legacy
 * (#456), sin distinguir mayúsculas ni espacios. Nunca devuelve el usuario de
 * sistema del importador. Las cuentas bloqueadas cuentan (el equipo del
 * Procomún antiguo quiere sus recursos asociados); las dadas de baja se
 * devuelven marcadas para que el llamante no les asigne nada. Igual las que no
 * han verificado el correo: con la verificación desactivada cualquiera puede
 * registrarse con el correo de un autor antiguo y quedarse con sus recursos.
 */
export async function findLegacyAuthorAccount(
	db: DrizzleDB,
	email: string,
): Promise<{ id: string; deleted: boolean; emailVerified: boolean } | null> {
	const normalized = normalizeLegacyPublicatorEmail(email);
	if (!normalized) return null;
	const [row] = await db
		.select({
			id: user.id,
			deletedAt: user.deletedAt,
			emailVerified: user.emailVerified,
		})
		.from(user)
		.where(
			and(
				eq(lowerEmail(user.email), normalized),
				ne(user.id, LEGACY_IMPORT_SYSTEM_USER_ID),
			),
		)
		.limit(1);
	return row
		? {
				id: row.id,
				deleted: row.deletedAt !== null,
				emailVerified: row.emailVerified,
			}
		: null;
}

export type LinkLegacyAuthorResult =
	| { outcome: "not_found" | "linked" | "already_linked" }
	| { outcome: "kept_creator"; createdBy: string };

/**
 * Pasa a `userId` un recurso legacy que sigue a nombre del sistema (#456):
 * creador vacío, como deja hoy el importador, o el usuario de sistema. Nunca
 * pisa a otro creador real, por ejemplo si alguien lo reasignó a mano; la
 * condición va en el propio UPDATE, así que tampoco con dos procesos a la vez.
 * No cambia `updatedAt`: cambiar de dueño no es editar el recurso.
 */
export async function linkLegacyResourceAuthor(
	db: DrizzleDB,
	resourceId: string,
	userId: string,
	options: { dryRun: boolean },
): Promise<LinkLegacyAuthorResult> {
	if (!options.dryRun) {
		const updated = await db
			.update(resources)
			.set({ createdBy: userId })
			.where(
				and(
					eq(resources.id, resourceId),
					or(
						isNull(resources.createdBy),
						eq(resources.createdBy, LEGACY_IMPORT_SYSTEM_USER_ID),
					),
				),
			)
			.returning({ id: resources.id });
		if (updated.length > 0) return { outcome: "linked" };
	}

	const [row] = await db
		.select({ createdBy: resources.createdBy })
		.from(resources)
		.where(eq(resources.id, resourceId))
		.limit(1);
	if (!row) return { outcome: "not_found" };
	if (row.createdBy === userId) return { outcome: "already_linked" };
	if (row.createdBy && row.createdBy !== LEGACY_IMPORT_SYSTEM_USER_ID) {
		return { outcome: "kept_creator", createdBy: row.createdBy };
	}
	// En seco: sigue a nombre del sistema, así que se enlazaría.
	return { outcome: "linked" };
}
