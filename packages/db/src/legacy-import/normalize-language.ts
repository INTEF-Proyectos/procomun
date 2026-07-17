import { VALID_LANGUAGES } from "../validation.ts";

export interface LanguageNormalizationResult {
	language: (typeof VALID_LANGUAGES)[number];
	/** true si no se reconoció ningún candidato y se usó el idioma por defecto */
	guessed: boolean;
}

const FALLBACK_LANGUAGE: (typeof VALID_LANGUAGES)[number] = "es";

// Variantes ISO 639-2/regionales vistas en metadatos legacy, mapeadas a los
// códigos ISO 639-1 soportados por VALID_LANGUAGES.
const LANGUAGE_ALIASES: Record<string, (typeof VALID_LANGUAGES)[number]> = {
	spa: "es",
	cat: "ca",
	eng: "en",
	eus: "eu",
	baq: "eu",
	glg: "gl",
	fra: "fr",
	fre: "fr",
	por: "pt",
	deu: "de",
	ger: "de",
	ita: "it",
};

/**
 * Normaliza los candidatos de idioma del JSON legacy (generalLanguageStr,
 * educationalLanguageStr) al enum VALID_LANGUAGES. Si ninguno es reconocible,
 * hace fallback a "es" marcado como `guessed: true` (tolerable, no bloqueante).
 */
export function normalizeLanguage(
	values: (string | null | undefined)[] | null | undefined,
): LanguageNormalizationResult {
	const candidates = (values ?? []).filter(
		(v): v is string => typeof v === "string" && v.trim().length > 0,
	);

	for (const raw of candidates) {
		const code = raw.trim().toLowerCase().split(/[-_]/)[0] ?? "";
		if ((VALID_LANGUAGES as readonly string[]).includes(code)) {
			return {
				language: code as (typeof VALID_LANGUAGES)[number],
				guessed: false,
			};
		}
		const aliased = LANGUAGE_ALIASES[code];
		if (aliased) {
			return { language: aliased, guessed: false };
		}
	}

	return { language: FALLBACK_LANGUAGE, guessed: true };
}
