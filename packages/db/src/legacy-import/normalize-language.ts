import { VALID_LANGUAGES } from "../validation.ts";

type Language = (typeof VALID_LANGUAGES)[number];

// Variantes ISO 639-2/regionales vistas en metadatos legacy, mapeadas a los
// códigos ISO 639-1 soportados por VALID_LANGUAGES.
const LANGUAGE_ALIASES: Record<string, Language> = {
	spa: "es",
	cat: "ca",
	// El Procomún antiguo etiqueta el valenciano como "va" (no es ISO 639);
	// en ISO es catalán (BCP 47: ca-valencia). Issue #473.
	va: "ca",
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
 * Normaliza los candidatos de idioma del JSON legacy (generalLanguageStr) al
 * enum VALID_LANGUAGES. Si ninguno es reconocible devuelve null: no se asume
 * un idioma que no esté en origen (issue #473).
 */
export function normalizeLanguage(
	values: (string | null | undefined)[] | null | undefined,
): Language | null {
	for (const raw of values ?? []) {
		if (typeof raw !== "string") continue;
		const code = raw.trim().toLowerCase().split(/[-_]/)[0] ?? "";
		if ((VALID_LANGUAGES as readonly string[]).includes(code)) {
			return code as Language;
		}
		const aliased = LANGUAGE_ALIASES[code];
		if (aliased) return aliased;
	}
	return null;
}
