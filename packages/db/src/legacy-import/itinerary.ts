import { buildSlug } from "../repository/shared/slugs.ts";
import { buildLegacyKeywords, IMPORT_SOURCE } from "./field-mapper.ts";
import {
	type LegacyEditorialStatus,
	resolveLegacyPublicationStatus,
} from "./publication-status.ts";
import { normalizeLegacyPublicatorEmail } from "./publicator-email.ts";

/**
 * Itinerarios del Procomún antiguo (#432). En el Procomún nuevo son
 * colecciones. El exportador los da todos en un único JSON (un array): ver
 * docs/epics/epic-004-migracion-legacy-procomun/design.md, sección del
 * 2026-11-16.
 */
export interface LegacyItineraryJson {
	id?: string | null;
	idDrupal?: string | null;
	type?: string | null;
	titleStr?: string | null;
	descriptionStr?: string | null;
	published?: number | string | null;
	publicationDate?: string | null;
	publicatorStr?: string | null;
	publicatorEmailStr?: string | null;
	/** ODE del itinerario: `idODE` (`es_…`) → título. */
	itineraryContent?: Record<string, string> | null;
	/** Artículos del itinerario: `id` del artículo → título. */
	interestContent?: Record<string, string> | null;
	baseItinerary?: unknown[] | null;
	knowledgeArea?: string[] | null;
	labelsStr?: string[] | null;
	learningContext?: string[] | null;
	educationalDescription?: string[] | null;
	urlDrupal?: string[] | null;
}

export type LegacyItineraryMetadata = {
	knowledgeArea: string[];
	labelsStr: string[];
	learningContext: string[];
};

export interface LegacyItineraryResourceRef {
	/** `external_id` con el que el importador de ODE (y de artículos) guarda el recurso. */
	externalId: string;
	kind: "ode" | "article";
}

export interface MappedLegacyItinerary {
	externalId: string;
	importSource: string;
	title: string;
	description: string;
	/** Base del slug; el repositorio le añade un sufijo para que sea único. */
	slugBase: string;
	editorialStatus: LegacyEditorialStatus;
	publishedAt: Date | null;
	isOrdered: boolean;
	/** Normalizado (minúsculas, sin espacios). Nunca va al informe general. */
	publicatorEmail: string | null;
	/** Primero los ODE y luego los artículos, cada uno en el orden del JSON. */
	resources: LegacyItineraryResourceRef[];
	metadata: LegacyItineraryMetadata;
	warnings: string[];
}

export interface LegacyItineraryMappingResult {
	mapped: MappedLegacyItinerary | null;
	blockingErrors: string[];
}

// Límites de validateCollection (packages/db/src/validation.ts).
const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 5000;

export function resolveLegacyItineraryId(json: unknown): string {
	const id = (json as { id?: unknown } | null)?.id;
	return typeof id === "string" ? id.trim() : "";
}

const HTML_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
};

/**
 * Descripción en texto plano. El exportador la da con saltos de Windows,
 * tabuladores, espacios duros y, a veces, HTML. Se quitan las etiquetas (las
 * de bloque pasan a salto de línea), se decodifican las entidades habituales
 * y se deja como mucho una línea en blanco seguida.
 */
export function cleanLegacyItineraryDescription(value: unknown): string {
	if (typeof value !== "string") return "";
	const text = value
		.replace(/\r\n?/g, "\n")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<\/(p|div|li|ul|ol|h[1-6]|tr|blockquote)\s*>/gi, "\n")
		.replace(/<[^>]*>/g, "")
		.replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name: string) => {
			return HTML_ENTITIES[name] ?? "";
		})
		.replace(/&#(\d+);/g, (entity, code: string) => {
			const point = Number(code);
			return point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)
				? entity
				: String.fromCodePoint(point);
		})
		.replace(/[\t ]/g, " ");
	return text
		.split("\n")
		.map((line) => line.replace(/ {2,}/g, " ").trim())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function truncate(value: string, max: number): string {
	return value.length > max ? value.slice(0, max) : value;
}

function contentKeys(value: unknown): string[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) return [];
	return Object.keys(value)
		.map((key) => key.trim())
		.filter(Boolean);
}

function metadataValues(value: unknown): string[] {
	const values = Array.isArray(value) ? value : [value];
	return [
		...new Set(
			values
				.filter((item): item is string => typeof item === "string")
				.map((item) => item.trim())
				.filter(Boolean),
		),
	];
}

function parsePublicationDate(value: unknown): Date | null | "invalid" {
	if (value == null || value === "") return null;
	if (typeof value !== "string") return "invalid";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "invalid" : date;
}

/**
 * Mapea un itinerario del Procomún antiguo a una colección. Es una función
 * pura: no toca la base de datos. Los recursos se identifican por el mismo
 * `external_id` que les da el importador de ODE (`idODE`, y el `id` en los
 * artículos de #446), con el mismo `import_source`.
 */
export function mapLegacyItinerary(
	json: LegacyItineraryJson,
): LegacyItineraryMappingResult {
	const blockingErrors: string[] = [];
	const warnings: string[] = [];

	const externalId = resolveLegacyItineraryId(json);
	if (!externalId) {
		blockingErrors.push(
			"Falta id: no se puede identificar ni deduplicar el itinerario",
		);
	}

	const rawTitle =
		typeof json.titleStr === "string" ? json.titleStr.trim() : "";
	if (!rawTitle) blockingErrors.push("Falta titleStr");
	if (blockingErrors.length > 0) return { mapped: null, blockingErrors };

	const title = truncate(rawTitle, MAX_TITLE_LENGTH);
	if (title.length < rawTitle.length) {
		warnings.push(`titleStr truncado a ${MAX_TITLE_LENGTH} caracteres`);
	}

	let description = [
		...new Set(
			[
				cleanLegacyItineraryDescription(json.descriptionStr),
				...metadataValues(json.educationalDescription).map(
					cleanLegacyItineraryDescription,
				),
			].filter(Boolean),
		),
	].join("\n\n");
	if (!description) {
		description = title;
		warnings.push("descriptionStr vacío: se usa el título como descripción");
	} else if (description.length > MAX_DESCRIPTION_LENGTH) {
		description = truncate(description, MAX_DESCRIPTION_LENGTH);
		warnings.push(
			`Descripción truncada a ${MAX_DESCRIPTION_LENGTH} caracteres`,
		);
	}

	const status = resolveLegacyPublicationStatus(json.published);
	if (!status.recognized && json.published != null) {
		warnings.push("published con valor desconocido: entra como borrador");
	}

	const publicationDate = parsePublicationDate(json.publicationDate);
	if (publicationDate === "invalid") {
		warnings.push("publicationDate no válida: se ignora");
	}

	// Primero los ODE y luego los artículos: el exportador los da en dos
	// bloques y no guarda cómo estaban intercalados. Dentro de cada bloque se
	// respeta el orden del JSON.
	const seen = new Set<string>();
	const resources: LegacyItineraryResourceRef[] = [];
	for (const [kind, block] of [
		["ode", json.itineraryContent],
		["article", json.interestContent],
	] as const) {
		for (const key of contentKeys(block)) {
			if (seen.has(key)) continue;
			seen.add(key);
			resources.push({ externalId: key, kind });
		}
	}

	const { keywords, truncated } = buildLegacyKeywords(
		metadataValues(json.labelsStr),
	);
	if (truncated)
		warnings.push("labelsStr truncado: se han omitido palabras clave");

	return {
		mapped: {
			externalId,
			importSource: IMPORT_SOURCE,
			title,
			description,
			slugBase: buildSlug(title) || "coleccion",
			editorialStatus: status.editorialStatus,
			publishedAt: publicationDate === "invalid" ? null : publicationDate,
			// Un itinerario es una secuencia de aprendizaje: el orden importa.
			isOrdered: true,
			publicatorEmail: normalizeLegacyPublicatorEmail(json.publicatorEmailStr),
			resources,
			metadata: {
				knowledgeArea: metadataValues(json.knowledgeArea),
				labelsStr: keywords?.split(",") ?? [],
				learningContext: metadataValues(json.learningContext),
			},
			warnings,
		},
		blockingErrors: [],
	};
}
