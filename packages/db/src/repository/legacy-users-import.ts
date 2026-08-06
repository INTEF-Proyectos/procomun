import { eq } from "drizzle-orm";
import type { MappedLegacyUser } from "../legacy-import/users.ts";
import { user } from "../schema/auth.ts";
import type { DrizzleDB } from "./shared.ts";

export type LegacyUserImportResult =
	| { outcome: "imported"; id: string }
	| { outcome: "skipped_existing_id"; id: string }
	| { outcome: "skipped_existing_email"; id: string };

/**
 * Inserta un usuario legacy sin cuenta de credenciales. El identificador
 * namespaced hace que la reejecución sea idempotente; el email único protege
 * las cuentas que ya existían en procomun-ng.
 */
export async function importLegacyUser(
	db: DrizzleDB,
	mapped: MappedLegacyUser,
): Promise<LegacyUserImportResult> {
	const existingById = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.id, mapped.id))
		.limit(1);
	if (existingById[0]) {
		return { outcome: "skipped_existing_id", id: existingById[0].id };
	}

	const existingByEmail = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, mapped.email))
		.limit(1);
	if (existingByEmail[0]) {
		return { outcome: "skipped_existing_email", id: existingByEmail[0].id };
	}

	const now = new Date();
	await db
		.insert(user)
		.values({
			id: mapped.id,
			email: mapped.email,
			emailVerified: false,
			name: mapped.name,
			role: mapped.role,
			isActive: mapped.isActive,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing();

	const inserted = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.id, mapped.id))
		.limit(1);
	if (inserted[0]) return { outcome: "imported", id: inserted[0].id };

	const concurrentByEmail = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.email, mapped.email))
		.limit(1);
	if (concurrentByEmail[0]) {
		return { outcome: "skipped_existing_email", id: concurrentByEmail[0].id };
	}

	throw new Error(`No se pudo importar el usuario legacy ${mapped.legacyUid}`);
}
