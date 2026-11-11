import type { MappingWarning } from "./types.ts";

/** Forma observada del exportador de usuarios del Procomún legacy. */
export interface LegacyUserJson {
	uid?: string | number | null;
	name?: string | null;
	mail?: string | null;
	roles?: string | null;
	status?: string | number | boolean | null;
}

export interface MappedLegacyUser {
	legacyUid: string;
	/** ID estable y con espacio de nombres, para reejecutar sin duplicar. */
	id: string;
	email: string;
	name: string | null;
	role: "admin" | "editor";
	isActive: boolean;
	warnings: MappingWarning[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asNonEmptyString(value: unknown): string | null {
	if (typeof value !== "string" && typeof value !== "number") return null;
	const normalized = String(value).trim();
	return normalized || null;
}

/**
 * Convierte un usuario legacy al mínimo compatible con Better Auth. Las
 * contraseñas Drupal no se incluyen: su hash no es portable de forma segura.
 */
/**
 * Prefijo del id de las cuentas que crea el importador de usuarios. Nadie que
 * se registre puede elegirlo, así que identifica de forma fiable una cuenta
 * migrada del Procomún antiguo (#508).
 */
export const LEGACY_USER_ID_PREFIX = "legacy-procomun:user:";

export function mapLegacyUser(record: LegacyUserJson): MappedLegacyUser {
	const legacyUid = asNonEmptyString(record.uid);
	if (!legacyUid) throw new Error("uid ausente o inválido");

	const rawEmail = asNonEmptyString(record.mail);
	const email = rawEmail?.toLowerCase();
	if (!email || !EMAIL_RE.test(email)) {
		throw new Error("mail ausente o inválido");
	}

	const legacyRole = asNonEmptyString(record.roles)?.toLowerCase();

	return {
		legacyUid,
		id: `${LEGACY_USER_ID_PREFIX}${legacyUid}`,
		email,
		name: asNonEmptyString(record.name),
		// Mantener la capacidad legacy: administrator → admin; resto → editor.
		role: legacyRole === "administrator" ? "admin" : "editor",
		// Las cuentas migradas deben poder recuperar credenciales e iniciar sesión.
		isActive: true,
		warnings: [],
	};
}
