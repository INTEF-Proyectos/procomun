import { VALID_LICENSES } from "../validation.ts";

export type LicenseCode = (typeof VALID_LICENSES)[number];

export interface LicenseNormalizationResult {
	license: LicenseCode | null;
	matched: boolean;
	rawInput: string;
}

function stripAccents(value: string): string {
	return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Normaliza el texto libre de licencia visto en el JSON legacy de Procomún
 * (p.ej. "creative commons: attribution - share alike 4.0") al enum
 * VALID_LICENSES. Combinaciones que no corresponden a ninguna licencia CC real
 * (p.ej. "non derived" + "share alike", mutuamente excluyentes) se consideran
 * no reconocidas, igual que cualquier texto que no mencione Creative Commons.
 */
export function normalizeLicense(
	raw: string | null | undefined,
): LicenseNormalizationResult {
	const rawInput = raw ?? "";
	if (!rawInput.trim()) {
		return { license: null, matched: false, rawInput };
	}

	const normalized = stripAccents(rawInput.toLowerCase())
		.replace(/\s+/g, " ")
		.trim();

	if (
		normalized.includes("cc0") ||
		normalized.includes("dominio publico") ||
		normalized.includes("public domain")
	) {
		return { license: "cc0", matched: true, rawInput };
	}

	const isCreativeCommons =
		normalized.includes("creative commons") ||
		/(^|[^a-z])cc([^a-z]|$)/.test(normalized);
	if (!isCreativeCommons) {
		return { license: null, matched: false, rawInput };
	}

	if (!normalized.includes("attribution")) {
		// Sin "attribution" no hay licencia CC estándar soportada por VALID_LICENSES.
		return { license: null, matched: false, rawInput };
	}

	const nc =
		normalized.includes("non commercial") ||
		normalized.includes("noncommercial");
	const sa =
		normalized.includes("share alike") || normalized.includes("sharealike");
	const nd =
		normalized.includes("non derived") ||
		normalized.includes("no derivs") ||
		normalized.includes("noderivs");

	if (nd && sa) {
		// ND y SA son mutuamente excluyentes en las licencias CC reales.
		return { license: null, matched: false, rawInput };
	}

	let code: string;
	if (nc && sa) code = "cc-by-nc-sa";
	else if (nc && nd) code = "cc-by-nc-nd";
	else if (sa) code = "cc-by-sa";
	else if (nd) code = "cc-by-nd";
	else if (nc) code = "cc-by-nc";
	else code = "cc-by";

	if (!(VALID_LICENSES as readonly string[]).includes(code)) {
		return { license: null, matched: false, rawInput };
	}

	return { license: code as LicenseCode, matched: true, rawInput };
}
