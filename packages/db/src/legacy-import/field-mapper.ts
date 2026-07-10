import { normalizeLanguage } from "./normalize-language.ts";
import { normalizeLicense } from "./normalize-license.ts";
import { mapResourceType } from "./resource-type-map.ts";
import type { LegacyOdeJson, MappedLegacyResource, MappingResult, MappingWarning } from "./types.ts";

const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_AUTHOR_LENGTH = 500;
const IMPORT_SOURCE = "legacy-procomun";

function firstNonEmpty(values: (string | null | undefined)[]): string {
	for (const value of values) {
		if (value && value.trim().length > 0) return value.trim();
	}
	return "";
}

function truncate(value: string, max: number): string {
	return value.length > max ? value.slice(0, max) : value;
}

function dedupeTrimmed(values: (string | null | undefined)[] | null | undefined): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of values ?? []) {
		const value = raw?.trim();
		if (value && !seen.has(value)) {
			seen.add(value);
			result.push(value);
		}
	}
	return result;
}

/**
 * lifecycleContributeStr contiene entradas tipo vCard, p.ej.:
 * "author##BEGIN:VCARD VERSION:3.0 FN: Nombre Apellido EMAIL;TYPE=INTERNET: ORG: ...END:VCARD##"
 * Se usa como último fallback para el autor cuando authorStr/publicatorNameStr
 * están vacíos.
 */
function extractVcardAuthorName(entries: (string | null | undefined)[] | null | undefined): string {
	for (const entry of entries ?? []) {
		if (!entry?.startsWith("author##")) continue;
		const match = entry.match(/FN:\s*([^]*?)\s*EMAIL/);
		const name = match?.[1]?.trim();
		if (name) return name;
	}
	return "";
}

function parseFechaRegistro(value: string | null | undefined): Date | null {
	if (!value || value.length !== 8) return null;
	const year = Number(value.slice(0, 4));
	const month = Number(value.slice(4, 6));
	const day = Number(value.slice(6, 8));
	const date = new Date(Date.UTC(year, month - 1, day));
	return Number.isNaN(date.getTime()) ? null : date;
}

function parseImportedAt(json: LegacyOdeJson): Date | null {
	if (json.publicationDate) {
		const date = new Date(json.publicationDate);
		if (!Number.isNaN(date.getTime())) return date;
	}
	return parseFechaRegistro(json.fechaRegistro);
}

/**
 * Mapea un registro JSON legacy de Procomún (ver docs/epics/epic-004-migracion-legacy-procomun/design.md)
 * al perfil mínimo de metadatos de procomun-ng (ADR-0009). No toca base de
 * datos ni el .elpx — es una función pura para poder testear el mapeo de
 * forma aislada.
 */
export function mapLegacyRecord(json: LegacyOdeJson, fallbackTitle: string): MappingResult {
	const warnings: MappingWarning[] = [];
	const blockingErrors: string[] = [];

	const externalId = (json.idODE ?? json.id ?? "").trim();
	if (!externalId) {
		blockingErrors.push("Falta idODE/id: no se puede identificar ni deduplicar el recurso");
	}

	const title = truncate((json.titleStr ?? "").trim(), MAX_TITLE_LENGTH) || fallbackTitle;

	const description = truncate(
		firstNonEmpty([json.descriptionStr, ...(json.educationalDescriptionStr ?? [])]),
		MAX_DESCRIPTION_LENGTH,
	);
	if (!description) {
		blockingErrors.push("descriptionStr y educationalDescriptionStr están vacíos");
	}

	const languageResult = normalizeLanguage([
		...(json.generalLanguageStr ?? []),
		...(json.educationalLanguageStr ?? []),
	]);
	if (languageResult.guessed) {
		warnings.push({
			field: "language",
			message: `Idioma no reconocido en los metadatos de origen, se asume "${languageResult.language}"`,
		});
	}

	const licenseResult = normalizeLicense(json.rightsCopyrightAndOtherRestrictionsStr);
	if (!licenseResult.matched) {
		blockingErrors.push(`Licencia no reconocida: "${licenseResult.rawInput}"`);
	}

	const resourceTypeResult = mapResourceType([
		...(json.resourceType ?? []),
		...(json.educationalLearningResourceTypeStr ?? []),
	]);
	if (!resourceTypeResult.mapped) {
		warnings.push({
			field: "resourceType",
			message: `Tipo de recurso sin equivalencia conocida, usando slug "${resourceTypeResult.resourceType}"`,
		});
	}

	const author =
		firstNonEmpty([
			...(json.authorStr ?? []),
			json.publicatorNameStr,
			extractVcardAuthorName(json.lifecycleContributeStr),
		]) || null;
	if (author) {
		const truncatedAuthor = truncate(author, MAX_AUTHOR_LENGTH);
		if (truncatedAuthor.length !== author.length) {
			warnings.push({ field: "author", message: "Autor truncado a 500 caracteres" });
		}
	}

	const publisher = (json.publicatorNameStr ?? "").trim() || null;
	const keywords = dedupeTrimmed(json.labelsStr).join(",") || null;
	const subjects = dedupeTrimmed(json.knowledgeArea);
	const levels = dedupeTrimmed(json.learningContext);
	const sourceUri = (json.rutaAccesoContenidos ?? json.technicalLocationStr ?? "").trim() || null;

	const resource: MappedLegacyResource = {
		externalId,
		importSource: IMPORT_SOURCE,
		sourceUri,
		title,
		description,
		language: languageResult.language,
		license: licenseResult.license,
		resourceType: resourceTypeResult.resourceType,
		subjects,
		levels,
		author: author ? truncate(author, MAX_AUTHOR_LENGTH) : null,
		publisher,
		keywords,
		importedAt: parseImportedAt(json),
	};

	return {
		externalId,
		blocking: blockingErrors.length > 0,
		blockingErrors,
		warnings,
		resource,
	};
}
