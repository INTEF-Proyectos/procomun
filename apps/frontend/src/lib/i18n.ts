/**
 * Locale utilities for Paraglide JS.
 * Reads locale from <html lang="..."> at runtime.
 */
import {
	overwriteGetLocale,
	baseLocale,
	locales,
	isLocale,
} from "../paraglide/runtime.js";

function resolveLocale(): string {
	if (typeof document !== "undefined") {
		const htmlLang = document.documentElement.lang;
		if (htmlLang && isLocale(htmlLang)) return htmlLang;
	}
	return baseLocale;
}

overwriteGetLocale(resolveLocale);

export { locales, baseLocale, isLocale };

/** All supported locales with their display labels. */
export const LOCALE_LABELS: Record<string, string> = {
	es: "Español",
	en: "English",
	ca: "Català",
	gl: "Galego",
	eu: "Euskara",
};
