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
	role: "admin" | "author";
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
export function mapLegacyUser(record: LegacyUserJson): MappedLegacyUser {
	const legacyUid = asNonEmptyString(record.uid);
	if (!legacyUid) throw new Error("uid ausente o inválido");

	const rawEmail = asNonEmptyString(record.mail);
	const email = rawEmail?.toLowerCase();
	if (!email || !EMAIL_RE.test(email)) {
		throw new Error("mail ausente o inválido");
	}

	const warnings: MappingWarning[] = [];
	const rawRole = asNonEmptyString(record.roles)?.toLowerCase() ?? "";
	const role = rawRole === "administrator" ? "admin" : "author";
	if (rawRole && rawRole !== "administrator" && rawRole !== "-") {
		warnings.push({
			field: "roles",
			message: `Rol legacy no reconocido (${rawRole}); se asigna author`,
		});
	}

	const rawStatus = record.status;
	const isActive = rawStatus === 1 || rawStatus === "1" || rawStatus === true;

	return {
		legacyUid,
		id: `legacy-procomun:user:${legacyUid}`,
		email,
		name: asNonEmptyString(record.name),
		role,
		isActive,
		warnings,
	};
}
