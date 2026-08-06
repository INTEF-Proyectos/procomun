/**
 * Resolve the external-embed relay mode for the ELPX preview overlay.
 *
 * 'strict' (default) only promotes the maintained providers (YouTube, Vimeo, Dailymotion,
 * EducaMadrid) with canonical URL reconstruction; 'open' is an explicit opt-in that promotes
 * any cross-origin https iframe. Any unset or unrecognised value fails safe to 'strict'.
 *
 * The relay treats anything that is not exactly 'strict' as open, so this fail-safe MUST run
 * here (before exeEmbedRelay.init()) — a tampered/invalid value must never silently weaken the
 * gate to open.
 */
export type EmbedMode = "strict" | "open";

export function resolveEmbedMode(value?: string | null): EmbedMode {
	return value === "open" ? "open" : "strict";
}

/**
 * The embed mode configured for this deployment, from the public env var
 * PUBLIC_EXELEARNING_EMBED_MODE. Defaults to (and fails safe to) 'strict'.
 */
export function configuredEmbedMode(): EmbedMode {
	const env = import.meta.env as Record<string, string | undefined> | undefined;
	return resolveEmbedMode(env?.PUBLIC_EXELEARNING_EMBED_MODE);
}
