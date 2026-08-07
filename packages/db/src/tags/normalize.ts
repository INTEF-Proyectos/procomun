/**
 * Pure helpers for atomized educational tags (issue #76 / ADR-0034).
 * No I/O — safe for API, CLI, and unit tests.
 */

const MAX_LABEL_LENGTH = 100;

/** Split a legacy free-text keywords field into individual tokens. */
export function parseKeywordString(value: string | null | undefined): string[] {
	if (value == null) return [];
	const trimmed = value.trim();
	if (!trimmed) return [];

	const parts = trimmed
		.split(/[,;|]/)
		.map((part) => part.trim().replace(/\s+/g, " "))
		.filter((part) => part.length > 0);

	// Preserve first-seen order, case-insensitive uniqueness of raw tokens
	const seen = new Set<string>();
	const out: string[] = [];
	for (const part of parts) {
		const key = part.toLocaleLowerCase("es");
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(part);
	}
	return out;
}

/** Normalize a human label for storage (trim, collapse spaces, cap length). */
export function normalizeTagLabel(raw: string): string | null {
	const label = raw.trim().replace(/\s+/g, " ").slice(0, MAX_LABEL_LENGTH);
	return label.length > 0 ? label : null;
}

/**
 * Stable slug for tags: accent-fold + lowercase + hyphenate.
 * Reuses the same rules as resource/taxonomy slugs for consistency.
 */
export function tagSlugFromLabel(label: string): string {
	const slug = label
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	return slug || "etiqueta";
}

/** Classic Levenshtein edit distance (codepoints). */
export function levenshteinDistance(a: string, b: string): number {
	if (a === b) return 0;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;

	const prev = new Array<number>(b.length + 1);
	const curr = new Array<number>(b.length + 1);
	for (let j = 0; j <= b.length; j++) prev[j] = j;

	for (let i = 1; i <= a.length; i++) {
		curr[0] = i;
		const ca = a.codePointAt(i - 1) ?? 0;
		for (let j = 1; j <= b.length; j++) {
			const cb = b.codePointAt(j - 1) ?? 0;
			const cost = ca === cb ? 0 : 1;
			const del = (prev[j] ?? 0) + 1;
			const ins = (curr[j - 1] ?? 0) + 1;
			const sub = (prev[j - 1] ?? 0) + cost;
			curr[j] = Math.min(del, ins, sub);
		}
		for (let j = 0; j <= b.length; j++) prev[j] = curr[j] ?? 0;
	}
	return prev[b.length] ?? 0;
}

export type SimilarTagCandidate = {
	id: string;
	label: string;
	slug: string;
};

/**
 * Rank catalog tags that look like duplicates of the given label/slug.
 * Compares against both folded slugs and lowercased labels.
 */
export function findSimilarTags(
	catalog: SimilarTagCandidate[],
	opts: {
		label: string;
		slug: string;
		excludeId?: string;
		maxDistance?: number;
		limit?: number;
	},
): SimilarTagCandidate[] {
	const maxDistance = opts.maxDistance ?? 2;
	const limit = opts.limit ?? 10;
	const targetSlug = opts.slug;
	const targetLabel = opts.label.toLocaleLowerCase("es");

	const scored = catalog
		.filter((t) => t.id !== opts.excludeId)
		.map((t) => {
			const slugDist = levenshteinDistance(targetSlug, t.slug);
			const labelDist = levenshteinDistance(
				targetLabel,
				t.label.toLocaleLowerCase("es"),
			);
			return { tag: t, distance: Math.min(slugDist, labelDist) };
		})
		.filter((row) => row.distance <= maxDistance)
		.sort(
			(a, b) =>
				a.distance - b.distance || a.tag.label.localeCompare(b.tag.label),
		);

	return scored.slice(0, limit).map((row) => row.tag);
}

/** Build a de-duplicated list of normalized labels from mixed inputs. */
export function uniqueNormalizedLabels(inputs: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of inputs) {
		const label = normalizeTagLabel(raw);
		if (!label) continue;
		const key = tagSlugFromLabel(label);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(label);
	}
	return out;
}
