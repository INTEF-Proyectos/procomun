/**
 * Catálogo cerrado de categorización educativa (issue #380).
 * Los identificadores son estables. Las etiquetas son las del formulario,
 * la ficha y el buscador. No hay texto libre ni «Sin segundo selector».
 */

export const EDUCATIONAL_SECTION_TITLE = "Categorización educativa";
export const EDUCATIONAL_CATEGORY_LABEL = "Etapa, programa o ámbito educativo";
export const EDUCATIONAL_OPTION_LABEL = "Ciclo, tramo, nivel o ámbito";

export interface EducationalOption {
	id: string;
	label: string;
}

export interface EducationalCategory {
	id: string;
	label: string;
	options: readonly EducationalOption[];
}

export interface EducationalAssignment {
	categoryId: string;
	optionId: string | null;
}

export interface EducationalAreaValidationIssue {
	field: string;
	message: string;
}

export const EDUCATIONAL_AREA_FIELD = "educationalAreas";

const OPTION_WITHOUT_CATEGORY =
	"La opción secundaria no puede guardarse sin su categoría principal";
const UNKNOWN_CATEGORY = "La categoría educativa no existe";
const UNKNOWN_COMBINATION = "La combinación de categoría y opción no existe";
const DUPLICATE_ASSIGNMENT = "La clasificación está duplicada";
const MIXED_ASSIGNMENT =
	"No se puede guardar la categoría sin opción y a la vez una opción de esa misma categoría";
const INVALID_LIST = "La categorización educativa debe ser una lista";
const INVALID_ITEM = "La categorización educativa no es válida";
const CATEGORY_REQUIRED = "La categoría principal es obligatoria";

export const EDUCATIONAL_CATEGORIES: readonly EducationalCategory[] = [
	{
		id: "educacion-infantil",
		label: "Educación Infantil",
		options: [
			{ id: "primer-ciclo", label: "Primer ciclo (0-3 años)" },
			{ id: "segundo-ciclo", label: "Segundo ciclo (3-6 años)" },
		],
	},
	{
		id: "educacion-primaria",
		label: "Educación Primaria",
		options: [
			{ id: "primer-tramo", label: "Primer tramo (1.º, 2.º y 3.º)" },
			{ id: "segundo-tramo", label: "Segundo tramo (4.º, 5.º y 6.º)" },
		],
	},
	{
		id: "educacion-secundaria-obligatoria",
		label: "Educación Secundaria Obligatoria",
		options: [
			{ id: "eso-1-2", label: "1.º y 2.º de ESO" },
			{ id: "eso-3-4", label: "3.º y 4.º de ESO" },
		],
	},
	{
		id: "bachillerato",
		label: "Bachillerato",
		options: [],
	},
	{
		id: "formacion-profesional",
		label: "Formación Profesional",
		options: [
			{ id: "grado-basico", label: "Grado básico" },
			{ id: "grado-medio", label: "Grado medio" },
			{ id: "grado-superior", label: "Grado superior" },
		],
	},
	{
		id: "pdc",
		label: "PDC - Programa de Diversificación Curricular",
		options: [
			{
				id: "ambito-linguistico-social",
				label: "Ámbito lingüístico y social",
			},
			{
				id: "ambito-cientifico-tecnologico",
				label: "Ámbito científico-tecnológico",
			},
			{ id: "otro-ambito", label: "Otro ámbito" },
		],
	},
	{
		id: "ele",
		label: "ELE - Español como Lengua Extranjera",
		options: [
			{ id: "basico", label: "Básico" },
			{ id: "medio", label: "Medio" },
			{ id: "avanzado", label: "Avanzado" },
		],
	},
	{
		id: "educacion-especial",
		label: "Educación Especial",
		options: [],
	},
	{
		id: "educacion-personas-adultas",
		label: "Educación de Personas Adultas",
		options: [],
	},
	{
		id: "ensenanzas-universitarias",
		label: "Enseñanzas Universitarias",
		options: [],
	},
	{
		id: "ensenanzas-regimen-especial",
		label: "Enseñanzas de Régimen Especial",
		options: [
			{ id: "musica", label: "Música" },
			{ id: "artes-plasticas-diseno", label: "Artes plásticas y diseño" },
			{ id: "danza", label: "Danza" },
			{ id: "ensenanzas-deportivas", label: "Enseñanzas deportivas" },
			{ id: "arte-dramatico", label: "Arte dramático" },
			{ id: "idiomas", label: "Idiomas" },
		],
	},
	{
		id: "formacion-profesorado",
		label: "Formación del Profesorado",
		options: [],
	},
];

const CATEGORY_BY_ID = new Map(
	EDUCATIONAL_CATEGORIES.map((category) => [category.id, category]),
);

export function getEducationalCategory(
	categoryId: string,
): EducationalCategory | null {
	return CATEGORY_BY_ID.get(categoryId) ?? null;
}

export function educationalOptionsFor(
	categoryId: string,
): readonly EducationalOption[] {
	return getEducationalCategory(categoryId)?.options ?? [];
}

export function categoryHasEducationalOptions(categoryId: string): boolean {
	return educationalOptionsFor(categoryId).length > 0;
}

export class EducationalAreaValidationError extends Error {
	readonly errors: EducationalAreaValidationIssue[];

	constructor(errors: EducationalAreaValidationIssue[]) {
		super(errors.map((issue) => issue.message).join("; "));
		this.name = "EducationalAreaValidationError";
		this.errors = errors;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(message: string): EducationalAreaValidationIssue {
	return { field: EDUCATIONAL_AREA_FIELD, message };
}

export function inspectEducationalAssignments(value: unknown): {
	assignments: EducationalAssignment[];
	errors: EducationalAreaValidationIssue[];
} {
	if (!Array.isArray(value)) {
		return { assignments: [], errors: [issue(INVALID_LIST)] };
	}

	const errors: EducationalAreaValidationIssue[] = [];
	const assignments: EducationalAssignment[] = [];
	const seen = new Set<string>();
	const withOption = new Set<string>();
	const categoryOnly = new Set<string>();

	for (const item of value) {
		if (!isRecord(item)) {
			errors.push(issue(INVALID_ITEM));
			continue;
		}

		const categoryId =
			typeof item.categoryId === "string" ? item.categoryId.trim() : "";
		const optionRaw = item.optionId;
		const optionProvided =
			optionRaw !== undefined && optionRaw !== null && optionRaw !== "";

		if (optionProvided && typeof optionRaw !== "string") {
			errors.push(issue(INVALID_ITEM));
			continue;
		}

		const optionId = optionProvided ? optionRaw.trim() : "";
		if (!categoryId) {
			errors.push(
				issue(optionId ? OPTION_WITHOUT_CATEGORY : CATEGORY_REQUIRED),
			);
			continue;
		}

		const category = getEducationalCategory(categoryId);
		if (!category) {
			errors.push(issue(UNKNOWN_CATEGORY));
			continue;
		}
		if (
			optionId &&
			!category.options.some((option) => option.id === optionId)
		) {
			errors.push(issue(UNKNOWN_COMBINATION));
			continue;
		}

		const normalizedOption = optionId || null;
		const key = `${categoryId}\0${normalizedOption ?? ""}`;
		if (seen.has(key)) {
			errors.push(issue(DUPLICATE_ASSIGNMENT));
			continue;
		}
		seen.add(key);
		if (normalizedOption) withOption.add(categoryId);
		else categoryOnly.add(categoryId);
		assignments.push({ categoryId, optionId: normalizedOption });
	}

	for (const categoryId of categoryOnly) {
		if (withOption.has(categoryId)) {
			errors.push(issue(MIXED_ASSIGNMENT));
		}
	}

	if (errors.length > 0) return { assignments: [], errors };
	return { assignments, errors };
}

export function validateEducationalAssignments(
	value: unknown,
): EducationalAreaValidationIssue[] {
	return inspectEducationalAssignments(value).errors;
}

export function normalizeEducationalAssignments(
	value: unknown,
): EducationalAssignment[] {
	const inspected = inspectEducationalAssignments(value);
	if (inspected.errors.length > 0) {
		throw new EducationalAreaValidationError(inspected.errors);
	}
	return inspected.assignments;
}
