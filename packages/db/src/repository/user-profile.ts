import { eq } from "drizzle-orm";
import { userProfile } from "../schema/user-profile.ts";
import {
	EMPTY_PROFILE_DETAILS,
	PROFILE_DETAIL_FIELDS,
	type ProfileDetails,
} from "../user-profile.ts";
import type { DrizzleDB } from "./shared.ts";

/**
 * Datos ampliados del perfil (#533). Son privados: solo se devuelven al dueño
 * de la cuenta. Sin fila, todos los campos van a null.
 */
export async function getUserProfileDetails(
	db: DrizzleDB,
	userId: string,
): Promise<ProfileDetails> {
	const rows = await db
		.select()
		.from(userProfile)
		.where(eq(userProfile.userId, userId))
		.limit(1);
	const row = rows[0];
	if (!row) return { ...EMPTY_PROFILE_DETAILS };
	const details = { ...EMPTY_PROFILE_DETAILS };
	for (const field of PROFILE_DETAIL_FIELDS) details[field] = row[field];
	return details;
}

/**
 * Guarda los campos que llegan, ya validados con `validateProfileUpdate`.
 * Crea la fila si no existe; los campos que no llegan no cambian.
 */
export async function saveUserProfileDetails(
	db: DrizzleDB,
	userId: string,
	details: Partial<ProfileDetails>,
): Promise<void> {
	const values: Partial<ProfileDetails> = {};
	for (const field of PROFILE_DETAIL_FIELDS) {
		if (details[field] !== undefined) values[field] = details[field];
	}
	if (Object.keys(values).length === 0) return;

	const now = new Date();
	await db
		.insert(userProfile)
		.values({ userId, ...values, createdAt: now, updatedAt: now })
		.onConflictDoUpdate({
			target: userProfile.userId,
			set: { ...values, updatedAt: now },
		});
}

/**
 * «Sobre mí» (#533). Vive en `user_profile.about`, privado como el resto del
 * perfil (ADR-0037); crea la fila si no existe y lo marca como escrito en la
 * plataforma nueva.
 */
export async function saveUserAbout(
	db: DrizzleDB,
	userId: string,
	about: string | null,
): Promise<void> {
	const now = new Date();
	await db
		.insert(userProfile)
		.values({
			userId,
			about,
			aboutEditedAt: now,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: userProfile.userId,
			set: { about, aboutEditedAt: now, updatedAt: now },
		});
}

/** «Sobre mí» completo, también el importado. Solo para su dueño. */
export async function getUserAbout(
	db: DrizzleDB,
	userId: string,
): Promise<string | null> {
	const rows = await db
		.select({ about: userProfile.about })
		.from(userProfile)
		.where(eq(userProfile.userId, userId))
		.limit(1);
	return rows[0]?.about ?? null;
}
