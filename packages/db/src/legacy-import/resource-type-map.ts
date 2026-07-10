export interface ResourceTypeMappingResult {
	resourceType: string;
	/** false si no había entrada en el diccionario y se usó un slug de fallback */
	mapped: boolean;
}

function stripAccents(value: string): string {
	return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeKey(value: string): string {
	return stripAccents(value.toLowerCase()).replace(/\s+/g, " ").trim();
}

function slugify(value: string): string {
	const slug = stripAccents(value.toLowerCase())
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "recurso";
}

// Equivalencias conocidas entre el vocabulario LOM-ES/legacy de Procomún
// (español o inglés, ver ode-export/) y el vocabulario informal ya usado por
// procomun-ng (apps/frontend/src/lib/resource-filters.ts, packages/db/src/seed-data.ts).
// Solo se listan equivalencias con confianza razonable; el resto cae al slug de
// fallback para no forzar una categorización incorrecta.
const RESOURCE_TYPE_DICTIONARY: Record<string, string> = {
	"basado en proyectos": "proyecto",
	"real project": "proyecto",
	proyecto: "proyecto",
	documento: "documento",
	presentacion: "presentacion",
	video: "video",
	audio: "audio",
	imagen: "imagen",
	evaluacion: "evaluacion",
	"cuestionario de autoevaluacion": "evaluacion",
	ejercicio: "ejercicio",
	"ejercicio o problema cerrado": "ejercicio",
	"ejercicio o problema abierto": "ejercicio",
	"secuencia didactica": "secuencia-didactica",
	"guia docente": "guia-docente",
	infografia: "infografia",
};

/**
 * Mapea los candidatos de tipo de recurso del JSON legacy (resourceType,
 * educationalLearningResourceTypeStr) al vocabulario informal de
 * `resources.resourceType` (sin enum en BD). Sin match en el diccionario,
 * genera un slug del valor original en vez de forzar una categoría — es un
 * caso tolerable, no bloqueante.
 */
export function mapResourceType(
	values: (string | null | undefined)[] | null | undefined,
): ResourceTypeMappingResult {
	const candidates = (values ?? []).filter(
		(v): v is string => typeof v === "string" && v.trim().length > 0,
	);

	for (const raw of candidates) {
		const mapped = RESOURCE_TYPE_DICTIONARY[normalizeKey(raw)];
		if (mapped) {
			return { resourceType: mapped, mapped: true };
		}
	}

	const first = candidates[0];
	if (!first) {
		return { resourceType: "documento", mapped: false };
	}

	return { resourceType: slugify(first), mapped: false };
}
