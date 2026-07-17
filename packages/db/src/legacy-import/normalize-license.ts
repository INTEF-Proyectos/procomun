import { VALID_LICENSES } from "../validation.ts";

export type LicenseCode = (typeof VALID_LICENSES)[number];

export interface LicenseNormalizationResult {
	license: LicenseCode | null;
	matched: boolean;
	rawInput: string;
	/**
	 * true cuando el texto de origen combinaba "no derivadas" (ND) y
	 * "compartir igual" (SA) — términos mutuamente excluyentes en las
	 * licencias Creative Commons reales (ND prohíbe obras derivadas; SA exige
	 * liberar las obras derivadas con la misma licencia) — y se resolvió
	 * priorizando SA sobre ND. Decisión de negocio confirmada para el
	 * importador legacy Procomún (ver ADR-0029): se asume un error de
	 * captura en el formulario de origen, no una licencia distinta.
	 */
	ndSaConflictResolved: boolean;
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
		return {
			license: null,
			matched: false,
			rawInput,
			ndSaConflictResolved: false,
		};
	}

	const normalized = stripAccents(rawInput.toLowerCase())
		.replace(/\s+/g, " ")
		.trim();

	if (
		normalized.includes("cc0") ||
		normalized.includes("dominio publico") ||
		normalized.includes("public domain")
	) {
		return {
			license: "cc0",
			matched: true,
			rawInput,
			ndSaConflictResolved: false,
		};
	}

	const isCreativeCommons =
		normalized.includes("creative commons") ||
		/(^|[^a-z])cc([^a-z]|$)/.test(normalized);
	if (!isCreativeCommons) {
		return {
			license: null,
			matched: false,
			rawInput,
			ndSaConflictResolved: false,
		};
	}

	if (!normalized.includes("attribution")) {
		// Sin "attribution" no hay licencia CC estándar soportada por VALID_LICENSES.
		return {
			license: null,
			matched: false,
			rawInput,
			ndSaConflictResolved: false,
		};
	}

	const nc =
		normalized.includes("non commercial") ||
		normalized.includes("noncommercial");
	const sa =
		normalized.includes("share alike") || normalized.includes("sharealike");
	let nd =
		normalized.includes("non derived") ||
		normalized.includes("no derivs") ||
		normalized.includes("noderivs");

	// ND y SA son mutuamente excluyentes en las licencias CC reales (ND
	// prohíbe derivadas, SA exige liberar las derivadas con la misma
	// licencia), así que esta combinación nunca es una licencia CC genuina —
	// es un error de captura del origen legacy. Se resuelve priorizando SA
	// (se descarta ND) en vez de bloquear el registro.
	const ndSaConflictResolved = nd && sa;
	if (ndSaConflictResolved) nd = false;

	let code: string;
	if (nc && sa) code = "cc-by-nc-sa";
	else if (nc && nd) code = "cc-by-nc-nd";
	else if (sa) code = "cc-by-sa";
	else if (nd) code = "cc-by-nd";
	else if (nc) code = "cc-by-nc";
	else code = "cc-by";

	if (!(VALID_LICENSES as readonly string[]).includes(code)) {
		return {
			license: null,
			matched: false,
			rawInput,
			ndSaConflictResolved: false,
		};
	}

	return {
		license: code as LicenseCode,
		matched: true,
		rawInput,
		ndSaConflictResolved,
	};
}
