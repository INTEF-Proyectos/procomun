import type { MappingWarning } from "./types.ts";

/**
 * Forma del exportador de usuarios del Procomún anterior (issue #456).
 *
 * Solo se leen los campos que se importan. Por minimización (RGPD, ADR-0037)
 * se ignoran a propósito DNI, fecha de nacimiento, sexo, nivel de estudios,
 * otros estudios, ocupación, zona horaria y descripción de organización. La
 * foto (`user_picture`) queda pendiente de que el exportador entregue los
 * ficheros.
 */
export interface LegacyUserJson {
	uid?: string | number | null;
	name?: string | null;
	pass?: string | null;
	mail?: string | null;
	roles?: string | null;
	status?: string | number | boolean | null;
	field_name_value?: string | null;
	field_surname_value?: string | null;
	field_surname_2_value?: string | null;
	field_country_country_code?: string | null;
	field_country_locality?: string | null;
	field_educative_center_value?: string | null;
	field_educative_center_url_uri?: string | null;
	field_sobre_mi_value?: string | null;
	field_website_value?: string | null;
	field_user_facebook_value?: string | null;
	field_user_linkedin_value?: string | null;
	field_user_twitter_value?: string | null;
	[field: string]: unknown;
}

export type LegacyUserRole = "admin" | "editor" | "author";

export interface LegacyUserProfile {
	countryCode: string | null;
	locality: string | null;
	educationalCenter: string | null;
	educationalCenterUrl: string | null;
	about: string | null;
	website: string | null;
	facebook: string | null;
	linkedin: string | null;
	twitter: string | null;
}

export interface MappedLegacyUser {
	legacyUid: string;
	/** ID estable y con espacio de nombres, para reejecutar sin duplicar. */
	id: string;
	email: string;
	/** Nombre visible: nombre y apellidos (nunca el correo). */
	name: string | null;
	role: LegacyUserRole;
	/** Roles del origen sin correspondencia; se listan en el informe. */
	unknownRoles: string[];
	/**
	 * `status: 0` en el origen. Los bloqueados no se importan: el importador
	 * los descarta y los cuenta en el informe.
	 */
	blocked: boolean;
	/** Hash bcrypt (`$2y$`) o Drupal 7 (`$S$`); se verifica en el primer login. */
	passwordHash: string | null;
	profile: LegacyUserProfile | null;
	warnings: MappingWarning[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Mismos formatos que verifica apps/api/src/auth/legacy-password.ts. */
const SUPPORTED_PASSWORD_HASH_RE =
	/^(?:\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}|\$S\$[./A-Za-z0-9]{52})$/;
const COUNTRY_CODE_RE = /^[A-Z]{2}$/;
const HAS_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const MAX_SHORT_TEXT = 255;
const MAX_ABOUT = 10_000;

/**
 * Correspondencia de roles acordada en la issue #456. Ningún rol antiguo da
 * `curator`; los no registrados (`reader`) no tienen cuenta que importar.
 */
const ROLE_MAP: Record<string, LegacyUserRole> = {
	administrator: "admin",
	administrador: "admin",
	publicador_certificado: "editor",
	"-": "author",
	bm_documentalista: "author",
	gestor_de_odes: "author",
};
const ROLE_RANK: Record<LegacyUserRole, number> = {
	author: 0,
	editor: 1,
	admin: 2,
};

function asNonEmptyString(value: unknown): string | null {
	if (typeof value !== "string" && typeof value !== "number") return null;
	const normalized = String(value).trim();
	return normalized || null;
}

/**
 * `roles` puede traer varios separados por coma; se queda el de más permisos
 * (admin > editor > author). Los desconocidos cuentan como author.
 */
export function mapLegacyRoles(raw: string | null | undefined): {
	role: LegacyUserRole;
	unknownRoles: string[];
} {
	let role: LegacyUserRole = "author";
	const unknownRoles: string[] = [];
	for (const part of (raw ?? "").split(",")) {
		const label = part.trim();
		if (!label) continue;
		const mapped = ROLE_MAP[label.toLowerCase()];
		if (!mapped) {
			unknownRoles.push(label);
			continue;
		}
		if (ROLE_RANK[mapped] > ROLE_RANK[role]) role = mapped;
	}
	return { role, unknownRoles };
}

function isBlocked(status: LegacyUserJson["status"]): boolean {
	return status === 0 || status === "0" || status === false;
}

function displayName(record: LegacyUserJson): string | null {
	const parts = [
		record.field_name_value,
		record.field_surname_value,
		record.field_surname_2_value,
	]
		.map(asNonEmptyString)
		.filter((part): part is string => part !== null);
	if (parts.length > 0) return parts.join(" ").replace(/\s+/g, " ");
	// `name` suele ser el correo: solo vale si no lo es.
	const userName = asNonEmptyString(record.name);
	return userName && !userName.includes("@") ? userName : null;
}

function shortText(
	value: unknown,
	field: string,
	warnings: MappingWarning[],
): string | null {
	const text = asNonEmptyString(value)?.replace(/\s+/g, " ");
	if (!text) return null;
	if (text.length > MAX_SHORT_TEXT) {
		warnings.push({
			field,
			message: `recortado a ${MAX_SHORT_TEXT} caracteres`,
		});
		return text.slice(0, MAX_SHORT_TEXT);
	}
	return text;
}

function webUrl(
	value: unknown,
	field: string,
	warnings: MappingWarning[],
): string | null {
	const raw = asNonEmptyString(value);
	if (!raw) return null;
	const candidate = HAS_SCHEME_RE.test(raw) ? raw : `https://${raw}`;
	try {
		const url = new URL(candidate);
		if (
			(url.protocol === "http:" || url.protocol === "https:") &&
			url.hostname.includes(".") &&
			url.href.length <= 2048
		) {
			return url.href;
		}
	} catch {
		// Se informa abajo.
	}
	warnings.push({ field, message: "URL no válida; no se importa" });
	return null;
}

function mapProfile(
	record: LegacyUserJson,
	warnings: MappingWarning[],
): LegacyUserProfile | null {
	const rawCountry = asNonEmptyString(record.field_country_country_code);
	const countryCode = rawCountry?.toUpperCase() ?? null;
	if (countryCode && !COUNTRY_CODE_RE.test(countryCode)) {
		warnings.push({
			field: "field_country_country_code",
			message: "código de país no válido; no se importa",
		});
	}

	let about =
		asNonEmptyString(record.field_sobre_mi_value)?.replace(/\r\n?/g, "\n") ??
		null;
	if (about && about.length > MAX_ABOUT) {
		warnings.push({
			field: "field_sobre_mi_value",
			message: `recortado a ${MAX_ABOUT} caracteres`,
		});
		about = about.slice(0, MAX_ABOUT);
	}

	const profile: LegacyUserProfile = {
		countryCode:
			countryCode && COUNTRY_CODE_RE.test(countryCode) ? countryCode : null,
		locality: shortText(
			record.field_country_locality,
			"field_country_locality",
			warnings,
		),
		educationalCenter: shortText(
			record.field_educative_center_value,
			"field_educative_center_value",
			warnings,
		),
		educationalCenterUrl: webUrl(
			record.field_educative_center_url_uri,
			"field_educative_center_url_uri",
			warnings,
		),
		about,
		website: webUrl(
			record.field_website_value,
			"field_website_value",
			warnings,
		),
		facebook: shortText(
			record.field_user_facebook_value,
			"field_user_facebook_value",
			warnings,
		),
		linkedin: shortText(
			record.field_user_linkedin_value,
			"field_user_linkedin_value",
			warnings,
		),
		twitter: shortText(
			record.field_user_twitter_value,
			"field_user_twitter_value",
			warnings,
		),
	};
	return Object.values(profile).some((value) => value !== null)
		? profile
		: null;
}

/**
 * Convierte un usuario del Procomún anterior en cuenta, credencial y perfil.
 * Los avisos nunca incluyen datos personales ni el hash.
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

	const name = displayName(record);
	if (!name) {
		warnings.push({
			field: "name",
			message: "sin nombre ni apellidos; la cuenta queda sin nombre visible",
		});
	}

	const { role, unknownRoles } = mapLegacyRoles(record.roles);
	if (unknownRoles.length > 0) {
		warnings.push({
			field: "roles",
			message: `rol sin correspondencia (${unknownRoles.join(", ")}); entra como author`,
		});
	}

	const pass = asNonEmptyString(record.pass);
	const passwordHash =
		pass && SUPPORTED_PASSWORD_HASH_RE.test(pass) ? pass : null;
	if (!passwordHash) {
		warnings.push({
			field: "pass",
			message: pass
				? "formato de contraseña no admitido; tendrá que recuperarla"
				: "sin contraseña; tendrá que recuperarla",
		});
	}

	return {
		legacyUid,
		id: `legacy-procomun:user:${legacyUid}`,
		email,
		name,
		role,
		unknownRoles,
		blocked: isBlocked(record.status),
		passwordHash,
		profile: mapProfile(record, warnings),
		warnings,
	};
}
