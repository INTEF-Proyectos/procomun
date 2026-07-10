import { normalizeLanguage } from "./normalize-language.ts";
import { normalizeLicense } from "./normalize-license.ts";
import { mapResourceType } from "./resource-type-map.ts";
import type { LegacyOdeJson, MappedLegacyResource, MappingResult, MappingWarning } from "./types.ts";

const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_AUTHOR_LENGTH = 500;
// Límites de columna/aplicación en el destino (ver packages/db/src/schema/resources.ts
// y packages/db/src/validation.ts): un valor legacy más largo debe truncarse con
// warning en vez de arriesgar un error de inserción en BD.
const MAX_RESOURCE_TYPE_LENGTH = 100; // resources.resource_type varchar(100)
const MAX_SUBJECT_LENGTH = 255; // resource_subjects.subject varchar(255)
const MAX_LEVEL_LENGTH = 100; // resource_levels.level varchar(100)
const MAX_KEYWORDS_LENGTH = 1000; // límite de aplicación en validateCreateResource
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
 * Trunca cada valor de una lista al límite de columna dado y vuelve a
 * deduplicar (dos valores distintos podrían colapsar al mismo prefijo tras
 * truncar). Devuelve cuántos valores se truncaron para poder avisar.
 */
function truncateList(values: string[], max: number): { values: string[]; truncatedCount: number } {
	let truncatedCount = 0;
	const truncated = values.map((value) => {
		if (value.length > max) {
			truncatedCount++;
			return value.slice(0, max);
		}
		return value;
	});
	return { values: [...new Set(truncated)], truncatedCount };
}

/**
 * Construye la cadena de `keywords` (join por comas) respetando el límite de
 * caracteres de aplicación: añade palabras clave mientras quepan enteras y
 * corta antes de partir una a la mitad, en vez de truncar el string final a
 * ciegas.
 */
function buildKeywords(values: string[], max: number): { keywords: string | null; truncated: boolean } {
	if (values.length === 0) return { keywords: null, truncated: false };

	let result = "";
	let truncated = false;
	for (const keyword of values) {
		const candidate = result ? `${result},${keyword}` : keyword;
		if (candidate.length > max) {
			truncated = true;
			break;
		}
		result = candidate;
	}

	if (!result) {
		// La primera palabra clave por sí sola ya supera el límite.
		result = truncate(values[0] ?? "", max);
		truncated = true;
	}

	return { keywords: result, truncated };
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
 * Resuelve el identificador externo de un registro legacy (`idODE`, con
 * fallback a `id`). Se exporta para que el CLI pueda resolverlo de forma
 * consistente al filtrar por `--only <externalId>` sin duplicar la lógica de
 * fallback de `mapLegacyRecord`.
 */
export function resolveLegacyExternalId(json: LegacyOdeJson): string {
	return firstNonEmpty([json.idODE, json.id]);
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

	const externalId = resolveLegacyExternalId(json);
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
	let resourceType = resourceTypeResult.resourceType;
	if (resourceType.length > MAX_RESOURCE_TYPE_LENGTH) {
		resourceType = truncate(resourceType, MAX_RESOURCE_TYPE_LENGTH);
		warnings.push({
			field: "resourceType",
			message: `Tipo de recurso truncado a ${MAX_RESOURCE_TYPE_LENGTH} caracteres`,
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

	const { keywords, truncated: keywordsTruncated } = buildKeywords(
		dedupeTrimmed(json.labelsStr),
		MAX_KEYWORDS_LENGTH,
	);
	if (keywordsTruncated) {
		warnings.push({
			field: "keywords",
			message: `Palabras clave truncadas a ${MAX_KEYWORDS_LENGTH} caracteres (alguna se omitió)`,
		});
	}

	const { values: subjects, truncatedCount: subjectsTruncated } = truncateList(
		dedupeTrimmed(json.knowledgeArea),
		MAX_SUBJECT_LENGTH,
	);
	if (subjectsTruncated > 0) {
		warnings.push({
			field: "subjects",
			message: `${subjectsTruncated} materia(s) truncada(s) a ${MAX_SUBJECT_LENGTH} caracteres`,
		});
	}

	const { values: levels, truncatedCount: levelsTruncated } = truncateList(
		dedupeTrimmed(json.learningContext),
		MAX_LEVEL_LENGTH,
	);
	if (levelsTruncated > 0) {
		warnings.push({
			field: "levels",
			message: `${levelsTruncated} nivel(es) truncado(s) a ${MAX_LEVEL_LENGTH} caracteres`,
		});
	}

	const sourceUri = firstNonEmpty([json.rutaAccesoContenidos, json.technicalLocationStr]) || null;

	const resource: MappedLegacyResource = {
		externalId,
		importSource: IMPORT_SOURCE,
		sourceUri,
		title,
		description,
		language: languageResult.language,
		license: licenseResult.license,
		resourceType,
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
