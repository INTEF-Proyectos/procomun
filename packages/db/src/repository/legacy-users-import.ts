import { and, eq } from "drizzle-orm";
import type { MappedLegacyUser } from "../legacy-import/users.ts";
import { account, lowerEmail, user } from "../schema/auth.ts";
import { userProfile } from "../schema/user-profile.ts";
import type { DrizzleDB } from "./shared.ts";

/** Lo que una reimportación añade a una cuenta legacy que ya existía. */
export type LegacyUserCompletion = "password" | "profile";

export type LegacyUserImportResult =
	| { outcome: "imported"; id: string }
	| {
			outcome: "skipped_existing_id";
			id: string;
			completed?: LegacyUserCompletion[];
	  }
	| { outcome: "skipped_existing_email"; id: string };

export type LegacyUserImportConflict =
	| { outcome: "skipped_existing_id"; id: string }
	| { outcome: "skipped_existing_email"; id: string };

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

function legacyAccountId(mapped: MappedLegacyUser): string {
	return `legacy-procomun:account:${mapped.legacyUid}`;
}

/** Inserta la cuenta de credenciales con el hash antiguo si no hay otra. */
async function addLegacyPassword(
	db: DrizzleDB,
	mapped: MappedLegacyUser,
	now: Date,
): Promise<boolean> {
	if (!mapped.passwordHash) return false;
	const existing = await db
		.select({ id: account.id })
		.from(account)
		.where(
			and(eq(account.userId, mapped.id), eq(account.providerId, "credential")),
		)
		.limit(1);
	if (existing[0]) return false;
	const inserted = await db
		.insert(account)
		.values({
			id: legacyAccountId(mapped),
			userId: mapped.id,
			accountId: mapped.id,
			providerId: "credential",
			password: mapped.passwordHash,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing()
		.returning({ id: account.id });
	return inserted.length > 0;
}

/** Inserta el perfil si aún no existe; nunca lo sobrescribe. */
async function addLegacyProfile(
	db: DrizzleDB,
	mapped: MappedLegacyUser,
	now: Date,
): Promise<boolean> {
	if (!mapped.profile) return false;
	const inserted = await db
		.insert(userProfile)
		.values({
			userId: mapped.id,
			...mapped.profile,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing()
		.returning({ userId: userProfile.userId });
	return inserted.length > 0;
}

/**
 * Importa un usuario del Procomún anterior: cuenta, cuenta de credenciales con
 * el hash antiguo (se sustituye en su primer inicio de sesión) y perfil.
 *
 * Idempotente por el ID `legacy-procomun:user:<uid>`. Reimportar no cambia
 * nombre, rol, estado, contraseña ni perfil de una cuenta existente: solo
 * añade lo que falte (cuentas creadas por la primera versión del importador,
 * #309, sin contraseña ni perfil). Una cuenta que ya existía con el mismo
 * correo no se toca. Los bloqueados (`status: 0`) no se importan.
 */
export async function importLegacyUser(
	db: DrizzleDB,
	mapped: MappedLegacyUser,
): Promise<LegacyUserImportResult> {
	if (mapped.blocked) {
		throw new Error(
			`El usuario legacy ${mapped.legacyUid} está bloqueado y no se importa`,
		);
	}
	const existing = await findLegacyUserImportConflict(db, mapped);
	if (existing?.outcome === "skipped_existing_email") return existing;
	if (existing) return completeExistingLegacyUser(db, mapped, existing.id);

	const now = new Date();
	const imported = await db.transaction(async (tx: DrizzleDB) => {
		const inserted = await tx
			.insert(user)
			.values({
				id: mapped.id,
				email: mapped.email,
				emailVerified: false,
				name: mapped.name,
				role: mapped.role,
				isActive: true,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing()
			.returning({ id: user.id });
		if (!inserted[0]) return null;
		await addLegacyPassword(tx, mapped, now);
		await addLegacyProfile(tx, mapped, now);
		return inserted[0].id;
	});
	if (imported) return { outcome: "imported", id: imported };

	const concurrent = await findLegacyUserImportConflict(db, mapped);
	if (concurrent) return concurrent;

	throw new Error(`No se pudo importar el usuario legacy ${mapped.legacyUid}`);
}

async function completeExistingLegacyUser(
	db: DrizzleDB,
	mapped: MappedLegacyUser,
	id: string,
): Promise<LegacyUserImportResult> {
	const now = new Date();
	const completed: LegacyUserCompletion[] = [];
	if (await addLegacyPassword(db, mapped, now)) completed.push("password");
	if (await addLegacyProfile(db, mapped, now)) completed.push("profile");
	return completed.length > 0
		? { outcome: "skipped_existing_id", id, completed }
		: { outcome: "skipped_existing_id", id };
}
