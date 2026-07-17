/**
 * Locale utilities for Paraglide JS.
 * Reads locale from <html lang="..."> at runtime.
 */
import {
	baseLocale,
	isLocale,
	locales,
	overwriteGetLocale,
} from "../paraglide/runtime.js";

type AppLocale = (typeof locales)[number];

function resolveLocale(): AppLocale {
	if (typeof document !== "undefined") {
		const htmlLang = document.documentElement.lang;
		if (htmlLang && isLocale(htmlLang)) return htmlLang;
	}
	return baseLocale;
}

overwriteGetLocale(resolveLocale);

export { baseLocale, isLocale, locales };

/** All supported locales with their display labels. */
export const LOCALE_LABELS: Record<string, string> = {
	es: "Español",
	en: "English",
	ca: "Català",
	gl: "Galego",
	eu: "Euskara",
};
