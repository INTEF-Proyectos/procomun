/**
 * Correspondencia de categorías antiguas de Procomún (learningContext)
 * hacia el catálogo de la issue #380. Lo que no tiene regla no se asigna.
 */

import {
	type EducationalAssignment,
	getEducationalCategory,
} from "../educational-areas.ts";

export interface LegacyEducationalCategoryRule {
	source: string;
	categoryId: string;
	optionId: string | null;
}

/** Las 31 correspondencias del listado de la issue #383, en ese orden. */
export const LEGACY_EDUCATIONAL_CATEGORY_RULES: readonly LegacyEducationalCategoryRule[] =
	[
		{
			source: "Educación Infantil",
			categoryId: "educacion-infantil",
			optionId: null,
		},
		{
			source: "Educación Primaria",
			categoryId: "educacion-primaria",
			optionId: null,
		},
		{
			source: "6 -7 años / Primer curso",
			categoryId: "educacion-primaria",
			optionId: "primer-ciclo",
		},
		{
			source: "7 - 8 años / Segundo curso",
			categoryId: "educacion-primaria",
			optionId: "primer-ciclo",
		},
		{
			source: "8 - 9 años / Tercer curso",
			categoryId: "educacion-primaria",
			optionId: "segundo-ciclo",
		},
		{
			source: "9 - 10 años / Cuarto curso",
			categoryId: "educacion-primaria",
			optionId: "segundo-ciclo",
		},
		{
			source: "10 - 11 años / Quinto curso",
			categoryId: "educacion-primaria",
			optionId: "tercer-ciclo",
		},
		{
			source: "11 - 12 / Sexto curso",
			categoryId: "educacion-primaria",
			optionId: "tercer-ciclo",
		},
		{
			source: "Educación Secundaria Obligatoria",
			categoryId: "educacion-secundaria-obligatoria",
			optionId: null,
		},
		{
			source: "12 - 13 años / Primer curso",
			categoryId: "educacion-secundaria-obligatoria",
			optionId: "eso-1-2",
		},
		{
			source: "13 - 14 años / Segundo curso",
			categoryId: "educacion-secundaria-obligatoria",
			optionId: "eso-1-2",
		},
		{
			source: "14 - 15 años / Tercer curso",
			categoryId: "educacion-secundaria-obligatoria",
			optionId: "eso-3-4",
		},
		{
			source: "15 - 16 / Cuarto curso",
			categoryId: "educacion-secundaria-obligatoria",
			optionId: "eso-3-4",
		},
		{
			source: "Bachillerato",
			categoryId: "bachillerato",
			optionId: null,
		},
		{
			source: "Formación Profesional",
			categoryId: "formacion-profesional",
			optionId: null,
		},
		{
			source: "Formación Profesional Básica (más de 15 años)",
			categoryId: "formacion-profesional",
			optionId: "grado-basico",
		},
		{
			source: "Ciclo formativo grado medio (más de 16 años)",
			categoryId: "formacion-profesional",
			optionId: "grado-medio",
		},
		{
			source: "Ciclo formativo grado superior (más de 18 años)",
			categoryId: "formacion-profesional",
			optionId: "grado-superior",
		},
		{
			source: "Educación Especial",
			categoryId: "educacion-especial",
			optionId: null,
		},
		{
			source: "Educación de Personas Adultas",
			categoryId: "educacion-personas-adultas",
			optionId: null,
		},
		{
			source: "Formación del Profesorado",
			categoryId: "formacion-profesorado",
			optionId: null,
		},
		{
			source: "Enseñanzas Universitarias",
			categoryId: "ensenanzas-universitarias",
			optionId: null,
		},
		{
			source: "Enseñanzas de música",
			categoryId: "ensenanzas-regimen-especial",
			optionId: "musica",
		},
		{
			source: "Enseñanzas de artes plásticas y diseño",
			categoryId: "ensenanzas-regimen-especial",
			optionId: "artes-plasticas-diseno",
		},
		{
			source: "Enseñanzas de danza",
			categoryId: "ensenanzas-regimen-especial",
			optionId: "danza",
		},
		{
			source: "Enseñanzas deportivas",
			categoryId: "ensenanzas-regimen-especial",
			optionId: "ensenanzas-deportivas",
		},
		{
			source: "Enseñanzas de arte dramático",
			categoryId: "ensenanzas-regimen-especial",
			optionId: "arte-dramatico",
		},
		{
			source: "Enseñanza oficial de idiomas",
			categoryId: "ensenanzas-regimen-especial",
			optionId: "idiomas",
		},
		{
			source: "Nivel básico (A)",
			categoryId: "ele",
			optionId: "basico",
		},
		{
			source: "Nivel intermedio (B)",
			categoryId: "ele",
			optionId: "medio",
		},
		{
			source: "Nivel avanzado ( C )",
			categoryId: "ele",
			optionId: "avanzado",
		},
	];

export interface LegacyEducationalCategoryMapping {
	assignments: EducationalAssignment[];
	unrecognized: string[];
	/** Niveles A/B/C de un recurso que no está en español: quedan para revisión. */
	eleOutsideSpanish: string[];
	empty: boolean;
}

export interface EducationalImportResourceNote {
	externalId: string;
	sourceCategories: readonly string[];
	language?: string | null;
}

export interface CategorizacionEducativaInforme {
	recursosConTodasTransformadas: number;
	recursosPendientesDeRevision: number;
	recursosSinCategorizacionDeOrigen: number;
	categoriasNoReconocidas: Array<{ categoria: string; recursos: string[] }>;
	eleEnOtroIdioma: string[];
}

const DASHES = /[\u2010\u2011\u2012\u2013\u2014\u2212]/g;

export function normalizeLegacyEducationalCategory(value: string): string {
	return value
		.normalize("NFKC")
		.replace(DASHES, "-")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase()
		.replace(/\s*-\s*/g, "-")
		.replace(/\(\s+/g, "(")
		.replace(/\s+\)/g, ")");
}

const RULES_BY_KEY = new Map<string, LegacyEducationalCategoryRule>();
for (const rule of LEGACY_EDUCATIONAL_CATEGORY_RULES) {
	const key = normalizeLegacyEducationalCategory(rule.source);
	if (RULES_BY_KEY.has(key)) {
		throw new Error(`Correspondencia duplicada: ${rule.source}`);
	}
	RULES_BY_KEY.set(key, rule);
}

export function assertLegacyCategoryDestinations(
	rules: readonly LegacyEducationalCategoryRule[] = LEGACY_EDUCATIONAL_CATEGORY_RULES,
): void {
	const missing: string[] = [];
	for (const rule of rules) {
		const category = getEducationalCategory(rule.categoryId);
		const optionOk =
			rule.optionId === null ||
			category?.options.some((option) => option.id === rule.optionId);
		if (!category || !optionOk) {
			missing.push(rule.source);
		}
	}
	if (missing.length > 0) {
		throw new Error(
			`Faltan destinos del catálogo educativo: ${missing.join(", ")}`,
		);
	}
}

// A, B y C son niveles del MCER, no exclusivos del español: solo son ELE
// cuando el recurso está en español (decisión de Producto en #383).
const ELE_CATEGORY_ID = "ele";

export function mapLegacyEducationalCategories(
	rawCategories: readonly string[] | null | undefined,
	language?: string | null,
): LegacyEducationalCategoryMapping {
	const sources = (rawCategories ?? [])
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
	if (sources.length === 0) {
		return {
			assignments: [],
			unrecognized: [],
			eleOutsideSpanish: [],
			empty: true,
		};
	}

	const unrecognized: string[] = [];
	const eleOutsideSpanish: string[] = [];
	const seenUnknown = new Set<string>();
	const byCategory = new Map<string, Set<string | null>>();

	for (const source of sources) {
		const rule = RULES_BY_KEY.get(normalizeLegacyEducationalCategory(source));
		if (!rule) {
			const key = normalizeLegacyEducationalCategory(source);
			if (!seenUnknown.has(key)) {
				seenUnknown.add(key);
				unrecognized.push(source);
			}
			continue;
		}
		if (rule.categoryId === ELE_CATEGORY_ID && language !== "es") {
			if (!eleOutsideSpanish.includes(source)) eleOutsideSpanish.push(source);
			continue;
		}
		const options = byCategory.get(rule.categoryId) ?? new Set();
		options.add(rule.optionId);
		byCategory.set(rule.categoryId, options);
	}

	const assignments: EducationalAssignment[] = [];
	for (const [categoryId, options] of byCategory) {
		const concrete = [...options].filter((optionId) => optionId !== null);
		const kept = concrete.length > 0 ? concrete : [null];
		for (const optionId of kept) {
			assignments.push({ categoryId, optionId });
		}
	}
	assignments.sort((a, b) => {
		const byCategoryId = a.categoryId.localeCompare(b.categoryId);
		if (byCategoryId !== 0) return byCategoryId;
		return (a.optionId ?? "").localeCompare(b.optionId ?? "");
	});

	return { assignments, unrecognized, eleOutsideSpanish, empty: false };
}

export function summarizeLegacyEducationalImport(
	notes: readonly EducationalImportResourceNote[],
): CategorizacionEducativaInforme {
	let recursosConTodasTransformadas = 0;
	let recursosPendientesDeRevision = 0;
	let recursosSinCategorizacionDeOrigen = 0;
	const unrecognized = new Map<string, string[]>();
	const eleEnOtroIdioma: string[] = [];
	const byResource = new Map<
		string,
		{ categories: string[]; language: string | null | undefined }
	>();
	for (const note of notes) {
		const previous = byResource.get(note.externalId);
		byResource.set(note.externalId, {
			categories: [...(previous?.categories ?? []), ...note.sourceCategories],
			language: note.language ?? previous?.language,
		});
	}

	for (const [externalId, { categories, language }] of byResource) {
		const mapped = mapLegacyEducationalCategories(categories, language);
		if (mapped.eleOutsideSpanish.length > 0) eleEnOtroIdioma.push(externalId);
		if (mapped.empty) {
			recursosSinCategorizacionDeOrigen++;
		} else if (
			mapped.unrecognized.length > 0 ||
			mapped.eleOutsideSpanish.length > 0
		) {
			recursosPendientesDeRevision++;
		} else {
			recursosConTodasTransformadas++;
		}
		for (const categoria of mapped.unrecognized) {
			const recursos = unrecognized.get(categoria) ?? [];
			if (!recursos.includes(externalId)) recursos.push(externalId);
			unrecognized.set(categoria, recursos);
		}
	}

	return {
		recursosConTodasTransformadas,
		recursosPendientesDeRevision,
		recursosSinCategorizacionDeOrigen,
		categoriasNoReconocidas: [...unrecognized.entries()].map(
			([categoria, recursos]) => ({ categoria, recursos }),
		),
		eleEnOtroIdioma,
	};
}
