export type ElpxMetadata = {
	title: string;
	description: string;
	author: string;
	license: string;
	language: string;
	learningResourceType: string;
};

export const METADATA_KEYS: Record<string, keyof ElpxMetadata> = {
	pp_title: "title",
	pp_description: "description",
	pp_author: "author",
	license: "license",
	pp_license: "license",
	lom_general_language: "language",
	pp_lang: "language",
	pp_learningResourceType: "learningResourceType",
};

export function emptyMetadata(): ElpxMetadata {
	return {
		title: "",
		description: "",
		author: "",
		license: "",
		language: "",
		learningResourceType: "",
	};
}

export function parseContentXml(xml: string): ElpxMetadata {
	const metadata = emptyMetadata();

	// Use [^<]* instead of .*? to avoid polynomial backtracking (CodeQL)
	const propertyRegex =
		/<odeProperty>\s*<key>([^<]*)<\/key>\s*<value>([^<]*)<\/value>\s*<\/odeProperty>/gs;

	for (const match of xml.matchAll(propertyRegex)) {
		const key = match[1]?.trim() ?? "";
		const value = match[2]?.trim() ?? "";
		const field = METADATA_KEYS[key];
		if (field) {
			metadata[field] = value;
		}
	}

	return metadata;
}
