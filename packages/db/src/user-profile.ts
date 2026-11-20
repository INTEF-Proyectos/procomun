/**
 * Perfil del usuario (issue #533): validación compartida por la API y la
 * pantalla `/perfil`.
 *
 * El nombre y el «Sobre mí» viven en `user` (`name`, `bio`). El resto, lo que
 * #488 importa del Procomún anterior, vive en `user_profile` y es privado: solo
 * lo ve su dueño hasta que #504 decida qué se muestra. Ocupación, estudios y
 * provincia quedan fuera por decisión de #494.
 */

/** Límites de longitud, en caracteres. Los mismos que usa el importador. */
export const PROFILE_LIMITS = {
	name: 255,
	bio: 10_000,
	shortText: 255,
	url: 2048,
} as const;

/** Campos de `user_profile` que se editan, en el orden del formulario. */
export const PROFILE_DETAIL_FIELDS = [
	"countryCode",
	"locality",
	"educationalCenter",
	"educationalCenterUrl",
	"website",
	"facebook",
	"twitter",
	"linkedin",
] as const;

export type ProfileDetailField = (typeof PROFILE_DETAIL_FIELDS)[number];
export type ProfileDetails = Record<ProfileDetailField, string | null>;

export const EMPTY_PROFILE_DETAILS: ProfileDetails = {
	countryCode: null,
	locality: null,
	educationalCenter: null,
	educationalCenterUrl: null,
	website: null,
	facebook: null,
	twitter: null,
	linkedin: null,
};

const URL_FIELDS = new Set<ProfileDetailField>([
	"educationalCenterUrl",
	"website",
]);

/** ISO 3166-1 alfa-2 (249 códigos). */
export const COUNTRY_CODES: readonly string[] = `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
DE DJ DK DM DO DZ
EC EE EG EH ER ES ET
FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
HK HM HN HR HT HU
ID IE IL IM IN IO IQ IR IS IT
JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ
LA LB LC LI LK LR LS LT LU LV LY
MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
NA NC NE NF NG NI NL NO NP NR NU NZ
OM
PA PE PF PG PH PK PL PM PN PR PS PT PW PY
QA
RE RO RS RU RW
SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ
UA UG UM US UY UZ
VA VC VE VG VI VN VU
WF WS
YE YT
ZA ZM ZW`
	.trim()
	.split(/\s+/);

const COUNTRY_CODE_SET = new Set(COUNTRY_CODES);
const HAS_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

export type ProfileErrorCode =
	| "required"
	| "too_long"
	| "invalid_type"
	| "invalid_url"
	| "invalid_country";

export interface ProfileFieldError {
	/** `name`, `bio`, `profile` o `profile.<campo>`. */
	field: string;
	code: ProfileErrorCode;
	message: string;
}

const MESSAGES: Record<ProfileErrorCode, string> = {
	required: "El nombre es obligatorio",
	too_long: "El texto es demasiado largo",
	invalid_type: "El valor no es válido",
	invalid_url: "La dirección web no es válida",
	invalid_country: "El país no es válido",
};

export interface NameAndBio {
	name?: string;
	bio?: string | null;
}

export interface ProfileUpdate extends NameAndBio {
	profile?: Partial<ProfileDetails>;
}

export type ValidationResult<T> =
	| { ok: true; value: T }
	| { ok: false; errors: ProfileFieldError[] };

function fail(field: string, code: ProfileErrorCode): ProfileFieldError {
	return { field, code, message: MESSAGES[code] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `""`, espacios y `null` cuentan como vacío. */
function optionalText(value: unknown): string | null | undefined {
	if (value === null) return null;
	if (typeof value !== "string") return undefined;
	return value.trim() || null;
}

/**
 * Dirección web: añade `https://` si no trae esquema y solo admite http(s) con
 * un dominio con punto, como el importador.
 */
export function normalizeWebUrl(raw: string): string | null {
	const candidate = HAS_SCHEME_RE.test(raw) ? raw : `https://${raw}`;
	try {
		const url = new URL(candidate);
		if (
			(url.protocol === "http:" || url.protocol === "https:") &&
			url.hostname.includes(".") &&
			url.href.length <= PROFILE_LIMITS.url
		) {
			return url.href;
		}
	} catch {
		// No es una URL.
	}
	return null;
}

/**
 * Nombre y «Sobre mí». Se usa en el perfil propio y en la administración de
 * usuarios: el nombre no puede quedar vacío y los dos tienen longitud máxima.
 */
export function validateUserNameAndBio(
	body: Record<string, unknown>,
): ValidationResult<NameAndBio> {
	const errors: ProfileFieldError[] = [];
	const value: NameAndBio = {};

	if ("name" in body) {
		const name = typeof body.name === "string" ? body.name.trim() : "";
		if (!name) errors.push(fail("name", "required"));
		else if (name.length > PROFILE_LIMITS.name)
			errors.push(fail("name", "too_long"));
		else value.name = name;
	}

	if ("bio" in body) {
		const text = optionalText(body.bio);
		const bio = text ? text.replace(/\r\n?/g, "\n") : text;
		if (bio === undefined) errors.push(fail("bio", "invalid_type"));
		else if (bio && bio.length > PROFILE_LIMITS.bio)
			errors.push(fail("bio", "too_long"));
		else value.bio = bio;
	}

	return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}

function validateDetail(
	field: ProfileDetailField,
	raw: unknown,
): { value: string | null } | { error: ProfileFieldError } {
	const key = `profile.${field}`;
	const text = optionalText(raw);
	if (text === undefined) return { error: fail(key, "invalid_type") };
	if (text === null) return { value: null };

	if (field === "countryCode") {
		const code = text.toUpperCase();
		return COUNTRY_CODE_SET.has(code)
			? { value: code }
			: { error: fail(key, "invalid_country") };
	}
	if (URL_FIELDS.has(field)) {
		const url = normalizeWebUrl(text);
		return url ? { value: url } : { error: fail(key, "invalid_url") };
	}
	return text.length > PROFILE_LIMITS.shortText
		? { error: fail(key, "too_long") }
		: { value: text };
}

/**
 * Cuerpo de `PATCH /users/me/profile`: `name`, `bio` y `profile` con los
 * campos de `user_profile`. Los campos que no llegan no se tocan y los que no
 * son del perfil se ignoran.
 */
export function validateProfileUpdate(
	body: Record<string, unknown>,
): ValidationResult<ProfileUpdate> {
	const base = validateUserNameAndBio(body);
	const errors = base.ok ? [] : [...base.errors];
	const value: ProfileUpdate = base.ok ? { ...base.value } : {};

	if ("profile" in body) {
		if (!isRecord(body.profile)) {
			errors.push(fail("profile", "invalid_type"));
		} else {
			const profile: Partial<ProfileDetails> = {};
			for (const field of PROFILE_DETAIL_FIELDS) {
				if (!(field in body.profile)) continue;
				const result = validateDetail(field, body.profile[field]);
				if ("error" in result) errors.push(result.error);
				else profile[field] = result.value;
			}
			value.profile = profile;
		}
	}

	return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}
