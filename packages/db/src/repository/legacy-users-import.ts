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

/** Motivo que se guarda al importar bloqueada una cuenta con `status: 0`. */
export const LEGACY_BLOCKED_REASON = "Cuenta bloqueada en el Procomún anterior";

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

/**
 * Inserta el perfil si no existe. Si ya existe (p. ej. la fila con solo la bio
 * que crea la migración 0023), rellena únicamente los campos vacíos: nunca
 * sobrescribe un valor ni la bio.
 * ponytail: un campo que la persona vació a mano se vuelve a rellenar al reimportar.
 */
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
	if (inserted.length > 0) return true;

	const [current] = await db
		.select()
		.from(userProfile)
		.where(eq(userProfile.userId, mapped.id))
		.limit(1);
	if (!current) return false;
	const missing = Object.fromEntries(
		Object.entries(mapped.profile).filter(
			([key, value]) =>
				value !== null && current[key as keyof typeof current] == null,
		),
	);
	if (Object.keys(missing).length === 0) return false;
	await db
		.update(userProfile)
		.set({ ...missing, updatedAt: now })
		.where(eq(userProfile.userId, mapped.id));
	return true;
}

/**
 * Importa un usuario del Procomún anterior: cuenta, cuenta de credenciales con
 * el hash antiguo (se sustituye en su primer inicio de sesión) y perfil.
 *
 * Idempotente por el ID `legacy-procomun:user:<uid>`. Reimportar no cambia
 * nombre, rol, estado, contraseña ni perfil de una cuenta existente: solo
 * añade lo que falte (cuentas creadas por la primera versión del importador,
 * #309, sin contraseña ni perfil). Una cuenta que ya existía con el mismo
 * correo no se toca. Los bloqueados (`status: 0`) se crean bloqueados, con
 * el mismo estado que pone la administración; reimportar no cambia el estado.
 * Las cuentas que entraron como `author` antes de #507 se corrigen aparte, con
 * fixLegacyUserRole (`import:legacy-users --fix-roles`).
 */
export async function importLegacyUser(
	db: DrizzleDB,
	mapped: MappedLegacyUser,
): Promise<LegacyUserImportResult> {
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
				isActive: !mapped.blocked,
				banned: mapped.blocked,
				banReason: mapped.blocked ? LEGACY_BLOCKED_REASON : null,
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

/** Prefijo del ID de las cuentas creadas por el importador de usuarios. */
export const LEGACY_USER_ID_PREFIX = "legacy-procomun:user:";

export type LegacyUserRoleFixResult =
	| { outcome: "fixed"; id: string; from: "author"; to: "editor" }
	/** Ya tiene el rol que da el mapeo. */
	| { outcome: "unchanged"; id: string; role: string }
	/** Otro rol (admin, curator, uno puesto a mano…): no se toca. */
	| { outcome: "kept"; id: string; role: string }
	/** No hay cuenta legacy con ese ID; una cuenta nativa nunca se busca. */
	| { outcome: "not_found"; id: string };

/**
 * Corrección de #507 para cuentas ya importadas: hasta entonces varios roles
 * antiguos daban `author` y ahora dan `editor`, y reimportar no cambia el rol.
 * Solo pasa de `author` a `editor`, y solo si el mapeo actual del registro da
 * `editor`. Busca por el ID `legacy-procomun:user:<uid>`, nunca por correo, así
 * que no toca cuentas ajenas a la migración. No cambia ningún otro rol (admin,
 * curator ni los puestos a mano) ni el estado, las credenciales, el perfil o
 * los recursos. Es repetible: una cuenta ya corregida queda `unchanged`.
 */
export async function fixLegacyUserRole(
	db: DrizzleDB,
	mapped: Pick<MappedLegacyUser, "id" | "role">,
	options: { dryRun?: boolean } = {},
): Promise<LegacyUserRoleFixResult> {
	const notFound = { outcome: "not_found", id: mapped.id } as const;
	if (!mapped.id.startsWith(LEGACY_USER_ID_PREFIX)) return notFound;

	const current = await currentRole(db, mapped.id);
	if (current === null) return notFound;
	if (current !== "author" || mapped.role !== "editor") {
		return keptOrUnchanged(mapped, current);
	}

	const fixed = {
		outcome: "fixed",
		id: mapped.id,
		from: "author",
		to: "editor",
	} as const;
	if (options.dryRun) return fixed;

	const updated = await db
		.update(user)
		.set({ role: "editor", updatedAt: new Date() })
		.where(and(eq(user.id, mapped.id), eq(user.role, "author")))
		.returning({ id: user.id });
	if (updated[0]) return fixed;

	// Otro proceso cambió el rol entre la lectura y la escritura.
	const changed = await currentRole(db, mapped.id);
	return changed === null ? notFound : keptOrUnchanged(mapped, changed);
}

async function currentRole(db: DrizzleDB, id: string): Promise<string | null> {
	const rows = await db
		.select({ role: user.role })
		.from(user)
		.where(eq(user.id, id))
		.limit(1);
	return rows[0]?.role ?? null;
}

function keptOrUnchanged(
	mapped: Pick<MappedLegacyUser, "id" | "role">,
	role: string,
): LegacyUserRoleFixResult {
	return role === mapped.role
		? { outcome: "unchanged", id: mapped.id, role }
		: { outcome: "kept", id: mapped.id, role };
}
