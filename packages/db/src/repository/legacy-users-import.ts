import { eq } from "drizzle-orm";
import type { MappedLegacyUser } from "../legacy-import/users.ts";
import { lowerEmail, user } from "../schema/auth.ts";
import type { DrizzleDB } from "./shared.ts";

export type LegacyUserImportResult =
	| { outcome: "imported"; id: string }
	| { outcome: "skipped_existing_id"; id: string }
	| { outcome: "skipped_existing_email"; id: string };

export type LegacyUserImportConflict = Exclude<
	LegacyUserImportResult,
	{ outcome: "imported" }
>;

export async function findLegacyUserImportConflict(
	db: DrizzleDB,
	mapped: MappedLegacyUser,
): Promise<LegacyUserImportConflict | null> {
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
		.where(eq(lowerEmail(user.email), mapped.email.toLowerCase()))
		.limit(1);
	if (existingByEmail[0]) {
		return { outcome: "skipped_existing_email", id: existingByEmail[0].id };
	}

	return null;
}

/**
 * Inserta un usuario legacy sin cuenta de credenciales. El identificador
 * namespaced hace que la reejecución sea idempotente; el email único protege
 * las cuentas que ya existían en procomun-ng.
 */
export async function importLegacyUser(
	db: DrizzleDB,
	mapped: MappedLegacyUser,
): Promise<LegacyUserImportResult> {
	const existing = await findLegacyUserImportConflict(db, mapped);
	if (existing) return existing;

	const now = new Date();
	const inserted = await db
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
		.onConflictDoNothing()
		.returning({ id: user.id });
	if (inserted[0]) return { outcome: "imported", id: inserted[0].id };

	const concurrent = await findLegacyUserImportConflict(db, mapped);
	if (concurrent) return concurrent;

	throw new Error(`No se pudo importar el usuario legacy ${mapped.legacyUid}`);
}
