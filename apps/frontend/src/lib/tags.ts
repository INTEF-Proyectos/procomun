/**
 * Client-side helpers for atomized tags (issue #76).
 * Mirrors server normalize rules for optimistic UI.
 */

export function parseTagsInput(value: string): string[] {
	if (!value.trim()) return [];
	const parts = value
		.split(/[,;|]/)
		.map((p) => p.trim().replace(/\s+/g, " "))
		.filter(Boolean);
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

export function formatTagsInput(labels: string[]): string {
	return labels.join(", ");
}

export function tagSlugClient(label: string): string {
	const slug = label
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	return slug || "etiqueta";
}
