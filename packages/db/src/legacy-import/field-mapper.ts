import { DEFAULT_LICENSE } from "../validation.ts";
import {
	buildLegacyArticleDescription,
	isLegacyArticle,
	LEGACY_ARTICLE_RESOURCE_TYPE,
} from "./article.ts";
import { normalizeLanguage } from "./normalize-language.ts";
import { normalizeLicense } from "./normalize-license.ts";
import { resolveLegacyPublicationStatus } from "./publication-status.ts";
import { normalizeLegacyPublicatorEmail } from "./publicator-email.ts";
import { mapResourceType } from "./resource-type-map.ts";
import type {
	LegacyOdeJson,
	MappedLegacyResource,
	MappingResult,
	MappingWarning,
} from "./types.ts";

const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_AUTHOR_LENGTH = 500;
const MAX_OTHER_AUTHORS_LENGTH = 1000; // límite de aplicación en validation.ts
// Límites de columna/aplicación en el destino (ver packages/db/src/schema/resources.ts
// y packages/db/src/validation.ts): un valor legacy más largo debe truncarse con
// warning en vez de arriesgar un error de inserción en BD.
const MAX_RESOURCE_TYPE_LENGTH = 100; // resources.resource_type varchar(100)
const MAX_SUBJECT_LENGTH = 255; // resource_subjects.subject varchar(255)
const MAX_LEVEL_LENGTH = 100; // resource_levels.level varchar(100)
const MAX_KEYWORDS_LENGTH = 1000; // límite de aplicación en validateCreateResource
export const IMPORT_SOURCE = "legacy-procomun";

function firstNonEmpty(values: (string | null | undefined)[]): string {
	for (const value of values) {
		if (value && value.trim().length > 0) return value.trim();
	}
	return "";
}

function truncate(value: string, max: number): string {
	return value.length > max ? value.slice(0, max) : value;
}

function dedupeTrimmed(
	values: (string | null | undefined)[] | null | undefined,
): string[] {
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
function truncateList(
	values: string[],
	max: number,
): { values: string[]; truncatedCount: number } {
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
function buildKeywords(
	values: string[],
	max: number,
): { keywords: string | null; truncated: boolean } {
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
 * están vacíos. El exportador a veces pone en FN el email de la cuenta en vez
 * de un nombre (#457); esos valores no son autores y se descartan.
 */
function extractVcardAuthorNames(
	entries: (string | null | undefined)[] | null | undefined,
): string[] {
	const names: string[] = [];
	for (const entry of entries ?? []) {
		if (!entry?.startsWith("author##")) continue;
		const match = entry.match(/FN:\s*([\s\S]*?)\s*EMAIL/);
		const name = match?.[1]?.trim();
		if (name && !isEmail(name)) names.push(name);
	}
	return names;
}

function isEmail(value: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function authorKey(name: string): string {
	return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("es");
}

/**
 * «Otros autores» (issue #417): todos los autores de authorStr y de las vCard
 * de autor que no son el autor principal, sin repetir (sin distinguir
 * mayúsculas ni espacios), unidos por comas. Corta antes de partir un nombre
 * si se pasa del límite de la aplicación.
 */
function buildOtherAuthors(
	candidates: string[],
	mainAuthor: string | null,
	max: number,
): { otherAuthors: string | null; truncated: boolean } {
	const seen = new Set<string>(mainAuthor ? [authorKey(mainAuthor)] : []);
	const names: string[] = [];
	for (const raw of candidates) {
		const name = raw.trim().replace(/\s+/g, " ");
		const key = authorKey(name);
		if (!name || isEmail(name) || seen.has(key)) continue;
		seen.add(key);
		names.push(name);
	}

	let result = "";
	let truncated = false;
	for (const name of names) {
		const candidate = result ? `${result}, ${name}` : name;
		if (candidate.length > max) {
			truncated = true;
			break;
		}
		result = candidate;
	}
	if (!result && names.length > 0) {
		result = truncate(names[0] ?? "", max);
		truncated = true;
	}

	return { otherAuthors: result || null, truncated };
}

/**
 * `Date.UTC(2023, 1, 31)` no lanza ni da NaN: JavaScript normaliza el
 * desbordamiento de calendario ("31 de febrero") a la fecha siguiente válida
 * (3 de marzo), en vez de señalar el valor de origen como inválido. Para
 * datos legacy (posible corrupción/exportación defectuosa) esto corrompería
 * en silencio `resources.importedAt`/`createdAt`, usado para ordenar el
 * catálogo público — por eso se valida con un round-trip explícito: si los
 * componentes que devuelve la fecha ya construida no coinciden con los que
 * pedimos, es que hubo desbordamiento y se rechaza.
 */
function isStrictCalendarDate(
	year: number,
	month: number,
	day: number,
): boolean {
	if (
		!Number.isInteger(year) ||
		!Number.isInteger(month) ||
		!Number.isInteger(day)
	)
		return false;
	if (month < 1 || month > 12) return false;
	if (day < 1 || day > 31) return false;
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year &&
		date.getUTCMonth() === month - 1 &&
		date.getUTCDate() === day
	);
}

function parseFechaRegistro(value: string | null | undefined): Date | null {
	if (!value || value.length !== 8) return null;
	const year = Number(value.slice(0, 4));
	const month = Number(value.slice(4, 6));
	const day = Number(value.slice(6, 8));
	return isStrictCalendarDate(year, month, day)
		? new Date(Date.UTC(year, month - 1, day))
		: null;
}

function parseImportedAt(json: LegacyOdeJson): Date | null {
	if (json.publicationDate) {
		// `new Date("2023-02-31")` tiene el mismo problema de normalización que
		// Date.UTC (ver isStrictCalendarDate arriba): se valida por separado el
		// componente de fecha del ISO string antes de confiar en el timestamp
		// completo que construye `new Date()` (que sí conserva hora/minuto/etc.).
		const dateOnly = json.publicationDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
		const dateOnlyValid =
			!dateOnly ||
			isStrictCalendarDate(
				Number(dateOnly[1]),
				Number(dateOnly[2]),
				Number(dateOnly[3]),
			);
		if (dateOnlyValid) {
			const date = new Date(json.publicationDate);
			if (!Number.isNaN(date.getTime())) return date;
		}
	}
	return parseFechaRegistro(json.fechaRegistro);
}

const MAX_PREVIEW_URL_LENGTH = 2000;

function mapPreviewImageUrl(raw: string | null | undefined): {
	url: string | null;
	warning: string | null;
} {
	const value = (raw ?? "").trim();
	if (!value) return { url: null, warning: null };
	if (value.length > MAX_PREVIEW_URL_LENGTH) {
		return {
			url: null,
			warning: `preview supera ${MAX_PREVIEW_URL_LENGTH} caracteres y no se importa`,
		};
	}
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return {
			url: null,
			warning: "preview no es una URL válida y no se importa",
		};
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return {
			url: null,
			warning: "preview debe usar http o https y no se importa",
		};
	}
	return { url: value, warning: null };
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
export function mapLegacyRecord(
	json: LegacyOdeJson,
	fallbackTitle: string,
): MappingResult {
	const warnings: MappingWarning[] = [];
	const blockingErrors: string[] = [];
	// #446: los artículos (`type: "POST"`) siguen sus propias reglas de
	// licencia, tipo, descripción y autor; el resto del mapeo es el de un ODE.
	const article = isLegacyArticle(json);

	const externalId = resolveLegacyExternalId(json);
	if (!externalId) {
		blockingErrors.push(
			"Falta idODE/id: no se puede identificar ni deduplicar el recurso",
		);
	}

	const title =
		truncate((json.titleStr ?? "").trim(), MAX_TITLE_LENGTH) || fallbackTitle;

	// Un artículo no tiene descripción: su `descriptionStr` es el cuerpo en
	// HTML. Se sustituye por un texto fijo y el cuerpo va en articleHtml.
	const description = article
		? buildLegacyArticleDescription(title)
		: truncate(
				firstNonEmpty([
					json.descriptionStr,
					...(json.educationalDescriptionStr ?? []),
				]),
				MAX_DESCRIPTION_LENGTH,
			);
	if (!description) {
		blockingErrors.push(
			"descriptionStr y educationalDescriptionStr están vacíos",
		);
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

	const licenseResult = normalizeLicense(
		json.rightsCopyrightAndOtherRestrictionsStr,
	);
	// Los artículos no traen licencia (#446): reciben la de por defecto de la
	// plataforma, con aviso para poder listarlos. Si alguno la trae, se respeta.
	const articleWithoutLicense = article && !licenseResult.rawInput.trim();
	if (articleWithoutLicense) {
		warnings.push({
			field: "license",
			message: `El artículo no trae licencia; se asigna la de por defecto de la plataforma ("${DEFAULT_LICENSE}")`,
		});
	} else if (!licenseResult.matched) {
		blockingErrors.push(`Licencia no reconocida: "${licenseResult.rawInput}"`);
	} else if (licenseResult.ndSaConflictResolved) {
		warnings.push({
			field: "license",
			message:
				`Licencia de origen combinaba "no derivadas" y "compartir igual" (mutuamente excluyentes en Creative Commons real); ` +
				`se asume "${licenseResult.license}" priorizando "compartir igual"`,
		});
	}

	// Todo artículo es del tipo «Artículo» (#446), traiga lo que traiga.
	const resourceTypeResult = article
		? { resourceType: LEGACY_ARTICLE_RESOURCE_TYPE, mapped: true }
		: mapResourceType([
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

	const vcardAuthors = extractVcardAuthorNames(json.lifecycleContributeStr);
	// Los artículos solo traen el nombre de quien publica en `publicatorStr`
	// (#446). La cuenta del autor se busca por correo, no por este nombre.
	const publisherName =
		firstNonEmpty([
			json.publicatorNameStr,
			article ? json.publicatorStr : null,
		]) || null;
	const author =
		firstNonEmpty([
			...(json.authorStr ?? []),
			publisherName,
			vcardAuthors[0],
		]) || null;
	if (author) {
		const truncatedAuthor = truncate(author, MAX_AUTHOR_LENGTH);
		if (truncatedAuthor.length !== author.length) {
			warnings.push({
				field: "author",
				message: "Autor truncado a 500 caracteres",
			});
		}
	}

	const { otherAuthors, truncated: otherAuthorsTruncated } = buildOtherAuthors(
		[...(json.authorStr ?? []), ...vcardAuthors].filter(
			(name): name is string => typeof name === "string",
		),
		author,
		MAX_OTHER_AUTHORS_LENGTH,
	);
	if (otherAuthorsTruncated) {
		warnings.push({
			field: "otherAuthors",
			message: `Otros autores truncados a ${MAX_OTHER_AUTHORS_LENGTH} caracteres (alguno se omitió)`,
		});
	}

	const publisher = publisherName;

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

	const sourceUri =
		firstNonEmpty([json.rutaAccesoContenidos, json.technicalLocationStr]) ||
		null;

	const previewImage = mapPreviewImageUrl(json.preview);
	if (previewImage.warning) {
		warnings.push({ field: "preview", message: previewImage.warning });
	}

	const publication = resolveLegacyPublicationStatus(json.published);
	if (!publication.recognized) {
		warnings.push({
			field: "published",
			message: `Valor de published ausente o no reconocido (${JSON.stringify(json.published ?? null)}); se importa como borrador`,
		});
	}

	const resource: MappedLegacyResource = {
		externalId,
		importSource: IMPORT_SOURCE,
		sourceUri,
		title,
		description,
		language: languageResult.language,
		license: articleWithoutLicense ? DEFAULT_LICENSE : licenseResult.license,
		resourceType,
		subjects,
		levels,
		author: author ? truncate(author, MAX_AUTHOR_LENGTH) : null,
		otherAuthors,
		publisher,
		keywords,
		importedAt: parseImportedAt(json),
		previewImageUrl: previewImage.url,
		editorialStatus: publication.editorialStatus,
		sourcePublished: publication.sourcePublished,
	};

	return {
		externalId,
		kind: article ? "article" : "ode",
		blocking: blockingErrors.length > 0,
		blockingErrors,
		warnings,
		publicatorEmail: normalizeLegacyPublicatorEmail(json.publicatorEmailStr),
		articleHtml: article ? (json.descriptionStr ?? null) : null,
		resource,
	};
}
