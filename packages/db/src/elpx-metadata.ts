export type ElpxMetadata = {
	title: string;
	description: string;
	author: string;
	license: string;
	language: string;
	learningResourceType: string;
	/** Identificador estable del proyecto eXeLearning (no cambia entre exportaciones). */
	odeId: string;
	/** Identificador de exportación de eXeLearning; informativo, no fiable como versión editorial. */
	odeVersionId: string;
	/** Versión de eXeLearning que generó el paquete (clave exe_version). */
	exeVersion: string;
	/** Estilo de eXeLearning del paquete (clave pp_theme). */
	theme: string;
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
	pp_theme: "theme",
};

// Identificadores que eXeLearning serializa como <odeResource> (no <odeProperty>).
// Ver doc/elpx-format/ids.md del repositorio exelearning/exelearning.
export const RESOURCE_KEYS: Record<string, keyof ElpxMetadata> = {
	odeId: "odeId",
	odeVersionId: "odeVersionId",
	exe_version: "exeVersion",
};

export function emptyMetadata(): ElpxMetadata {
	return {
		title: "",
		description: "",
		author: "",
		license: "",
		language: "",
		learningResourceType: "",
		odeId: "",
		odeVersionId: "",
		exeVersion: "",
		theme: "",
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

	const resourceRegex =
		/<odeResource>\s*<key>([^<]*)<\/key>\s*<value>([^<]*)<\/value>\s*<\/odeResource>/gs;

	for (const match of xml.matchAll(resourceRegex)) {
		const key = match[1]?.trim() ?? "";
		const value = match[2]?.trim() ?? "";
		const field = RESOURCE_KEYS[key];
		if (field) {
			metadata[field] = value;
		}
	}

	return metadata;
}
