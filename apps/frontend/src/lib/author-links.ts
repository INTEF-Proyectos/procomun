import { url } from "./paths.ts";

/** Coletilla final del tipo «… para Cedec» (una sola palabra tras «para»). */
const TRAILING_FOR = /\s*(?:…|\.{3})?\s+para\s+\S+$/iu;
const TRAILING_ELLIPSIS = /\s*(?:…|\.{3})$/u;

/**
 * Nombres del campo libre `author` (#458): separa por comas o punto y coma y
 * quita coletillas como «… para Cedec». Sin duplicados (sin distinguir
 * mayúsculas) y conservando el orden.
 */
export function splitAuthorNames(author: string | null | undefined): string[] {
	if (!author) return [];
	const names: string[] = [];
	const seen = new Set<string>();
	for (const part of author.trim().replace(TRAILING_FOR, "").split(/[,;]/)) {
		const name = part.trim().replace(TRAILING_ELLIPSIS, "").trim();
		const key = name.toLocaleLowerCase("es");
		if (!name || seen.has(key)) continue;
		seen.add(key);
		names.push(name);
	}
	return names;
}

/** Ficha pública de la cuenta que publica (#458). */
export function authorProfileHref(id: string): string {
	return url(`autor/${encodeURIComponent(id)}`);
}
