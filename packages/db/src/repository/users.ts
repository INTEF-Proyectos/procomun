import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { account, lowerEmail, session, user } from "../schema/auth.ts";
import { userProfile } from "../schema/user-profile.ts";
import type { ProfileUpdate } from "../user-profile.ts";
import {
	andWhere,
	buildSearchTerm,
	type DrizzleDB,
	normalizePagination,
	normalizeSearch,
} from "./shared.ts";
import { saveUserAbout, saveUserProfileDetails } from "./user-profile.ts";

/**
 * `bio` es el «Sobre mí», que vive en `user_profile.about` desde #533. Solo
 * sale el escrito en la plataforma nueva, como cuando era `user.bio`: el
 * importado sin editar queda para su dueño (`getUserAbout`) hasta que #504
 * decida si lo ve la administración (revisión de #586).
 */
const USER_COLUMNS = {
	id: user.id,
	email: user.email,
	name: user.name,
	bio: sql<
		string | null
	>`CASE WHEN ${userProfile.aboutEditedAt} IS NOT NULL THEN ${userProfile.about} END`,
	role: user.role,
	isActive: user.isActive,
	createdAt: user.createdAt,
	updatedAt: user.updatedAt,
} as const;

export async function listUsers(
	db: DrizzleDB,
	opts: {
		limit?: number;
		offset?: number;
		search?: string;
		role?: string;
		id?: string;
		isActive?: boolean;
	} = {},
) {
	const { limit, offset } = normalizePagination(opts.limit, opts.offset);
	// Excluir usuarios dados de baja lógica (DEF-020).
	const conditions = [isNull(user.deletedAt)];

	if (opts.search) {
		const term = buildSearchTerm(opts.search);
		conditions.push(
			sql`(${normalizeSearch(user.name)} LIKE ${term} OR ${normalizeSearch(user.email)} LIKE ${term})`,
		);
	}
	if (opts.role) conditions.push(eq(user.role, opts.role));
	if (opts.id) conditions.push(eq(user.id, opts.id));
	if (opts.isActive !== undefined)
		conditions.push(eq(user.isActive, opts.isActive));

	const where = andWhere(conditions);

	const query = db
		.select(USER_COLUMNS)
		.from(user)
		.leftJoin(userProfile, eq(userProfile.userId, user.id))
		.limit(limit)
		.offset(offset)
		.orderBy(asc(user.name), asc(user.email));
	const rows = where ? await query.where(where) : await query;

	const countQuery = db.select({ count: sql<number>`count(*)` }).from(user);
	const countRows = where ? await countQuery.where(where) : await countQuery;

	return { data: rows, total: Number(countRows[0]?.count ?? 0), limit, offset };
}

export async function getUserById(db: DrizzleDB, id: string) {
	// Excluye usuarios dados de baja lógica (DEF-020): un usuario eliminado no
	// debe poder consultarse, reactivarse ni re-eliminarse.
	const rows = await db
		.select(USER_COLUMNS)
		.from(user)
		.leftJoin(userProfile, eq(userProfile.userId, user.id))
		.where(and(eq(user.id, id), isNull(user.deletedAt)))
		.limit(1);

	return rows[0] ?? null;
}

export async function getUserByEmail(db: DrizzleDB, email: string) {
	const rows = await db
		.select(USER_COLUMNS)
		.from(user)
		.leftJoin(userProfile, eq(userProfile.userId, user.id))
		.where(eq(lowerEmail(user.email), email.trim().toLowerCase()))
		.limit(1);

	return rows[0] ?? null;
}

export async function ensureUser(
	db: DrizzleDB,
	data: { id: string; email: string; name?: string | null; role?: string },
) {
	await db
		.insert(user)
		.values({
			id: data.id,
			email: data.email.trim().toLowerCase(),
			name: data.name ?? null,
			role: data.role ?? "author",
			emailVerified: true,
			isActive: true,
			createdAt: new Date(),
			updatedAt: new Date(),
		})
		.onConflictDoNothing();

	return getUserById(db, data.id);
}

export async function updateUser(
	db: DrizzleDB,
	id: string,
	data: Partial<{
		name: string | null;
		bio: string | null;
		role: string;
		isActive: boolean;
	}>,
) {
	const { isActive, bio, ...rest } = data;
	if (bio !== undefined) await saveUserAbout(db, id, bio);
	if (Object.keys(rest).length > 0) {
		await db
			.update(user)
			.set({ ...rest, updatedAt: new Date() })
			.where(eq(user.id, id));
	}
	if (isActive !== undefined) await setUserBlocked(db, id, !isActive);
}

/**
 * Perfil propio (#533): nombre, «Sobre mí» y datos ampliados en una sola
 * transacción, para no dejar un cambio a medias si falla la última escritura.
 */
export async function updateOwnProfile(
	db: DrizzleDB,
	id: string,
	{ profile, ...data }: ProfileUpdate,
): Promise<void> {
	await db.transaction(async (tx: DrizzleDB) => {
		await updateUser(tx, id, data);
		if (profile) await saveUserProfileDetails(tx, id, profile);
	});
}

/** Motivo que se guarda en `ban_reason` cuando bloquea la administración. */
export const ADMIN_BLOCKED_REASON = "Bloqueada por la administración";

/**
 * Estado «bloqueado» de una cuenta (#456). `is_active = false` es el estado
 * de la plataforma (administración, tokens de API) y `banned` el que aplica
 * better-auth al iniciar sesión; se cambian siempre juntos. Al bloquear se
 * cierran sus sesiones. Una cuenta dada de baja no se desbloquea.
 */
export async function setUserBlocked(
	db: DrizzleDB,
	id: string,
	blocked: boolean,
	reason: string = ADMIN_BLOCKED_REASON,
) {
	const now = new Date();
	if (blocked) {
		await db
			.update(user)
			.set({
				isActive: false,
				banned: true,
				banReason: reason,
				banExpires: null,
				updatedAt: now,
			})
			.where(eq(user.id, id));
		await db.delete(session).where(eq(session.userId, id));
		return;
	}
	await db
		.update(user)
		.set({
			isActive: true,
			banned: false,
			banReason: null,
			banExpires: null,
			updatedAt: now,
		})
		.where(and(eq(user.id, id), isNull(user.deletedAt)));
}

/**
 * Crea un usuario y su cuenta de credenciales (email + contraseña ya hasheada)
 * sin generar ninguna sesión. Pensado para el alta desde administración (DEF-019):
 * el alta no debe iniciar sesión como el usuario recién creado.
 */
export async function createUserWithCredentials(
	db: DrizzleDB,
	data: {
		email: string;
		name?: string | null;
		role?: string;
		passwordHash: string;
	},
) {
	const id = crypto.randomUUID();
	const now = new Date();

	await db.insert(user).values({
		id,
		email: data.email.trim().toLowerCase(),
		name: data.name ?? null,
		role: data.role ?? "author",
		emailVerified: true,
		isActive: true,
		createdAt: now,
		updatedAt: now,
	});

	await db.insert(account).values({
		id: crypto.randomUUID(),
		userId: id,
		accountId: id,
		providerId: "credential",
		password: data.passwordHash,
		createdAt: now,
		updatedAt: now,
	});

	return getUserById(db, id);
}

/**
 * Baja lógica de un usuario (DEF-020): lo marca como eliminado para que deje de
 * aparecer en el listado de administración, lo desactiva y lo banea para impedir
 * el inicio de sesión, conservando la trazabilidad y la integridad referencial.
 */
export async function softDeleteUser(db: DrizzleDB, id: string) {
	const now = new Date();
	await db
		.update(user)
		.set({ deletedAt: now, isActive: false, banned: true, updatedAt: now })
		.where(eq(user.id, id));

	// Revoca las sesiones activas para que la baja surta efecto de inmediato.
	// (Better Auth solo aplica `banned` en nuevos inicios de sesión; el middleware
	// de sesión confía en la cookie existente, así que hay que borrar las sesiones,
	// igual que hace el endpoint ban-user de Better Auth con deleteUserSessions.)
	await db.delete(session).where(eq(session.userId, id));
}
