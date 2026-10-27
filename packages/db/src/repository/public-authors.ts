import { and, eq, isNull, sql } from "drizzle-orm";
import { user } from "../schema/auth.ts";
import { resources } from "../schema/resources.ts";
import type { DrizzleDB } from "./shared.ts";

/** Datos públicos de la cuenta que publica recursos (#458). Sin correo ni rol. */
export type PublicAuthor = {
	id: string;
	name: string | null;
	image: string | null;
};

/**
 * Ficha pública de una cuenta. Solo existe para cuentas activas (sin baja
 * lógica) que hayan creado algún recurso: así no se pueden recorrer por id los
 * nombres de lectores que nunca han publicado.
 */
export async function getPublicAuthor(
	db: DrizzleDB,
	id: string,
): Promise<PublicAuthor | null> {
	const rows = await db
		.select({ id: user.id, name: user.name, image: user.image })
		.from(user)
		.where(
			and(
				eq(user.id, id),
				isNull(user.deletedAt),
				sql`exists (select 1 from ${resources} where ${resources.createdBy} = ${user.id})`,
			),
		)
		.limit(1);
	return rows[0] ?? null;
}
