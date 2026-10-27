import { validateEducationalAssignments } from "./educational-areas.ts";

export const VALID_TAXONOMY_TYPES = [
	"category",
	"tag",
	"subject",
	"level",
	"resource-type",
	"language",
	"license",
] as const;
export type TaxonomyType = (typeof VALID_TAXONOMY_TYPES)[number];

export const VALID_STATUSES = [
	"draft",
	"review",
	"published",
	"archived",
] as const;
export type EditorialStatus = (typeof VALID_STATUSES)[number];

export const VALID_LANGUAGES = [
	"es",
	"en",
	"ca",
	"eu",
	"gl",
	"fr",
	"pt",
	"de",
	"it",
] as const;

export const VALID_LICENSES = [
	"cc-by",
	"cc-by-sa",
	"cc-by-nc",
	"cc-by-nc-sa",
	"cc-by-nc-nd",
	"cc-by-nd",
	"cc0",
] as const;

export interface ValidationError {
	field: string;
	message: string;
}

export interface ValidationResult {
	valid: boolean;
	errors: ValidationError[];
}

function isNonEmptyString(v: unknown): v is string {
	return typeof v === "string" && v.trim().length > 0;
}

function isStringArray(v: unknown): v is string[] {
	return Array.isArray(v) && v.every((i) => typeof i === "string");
}

export const MAX_OTHER_AUTHORS_LENGTH = 1000;

// «Otros autores» (issue #417): texto libre opcional; vacío equivale a no tenerlo.
function validateOtherAuthors(value: unknown): ValidationError[] {
	if (value === undefined || value === null) return [];
	if (typeof value !== "string") {
		return [
			{ field: "otherAuthors", message: "Los otros autores deben ser texto" },
		];
	}
	if (value.length > MAX_OTHER_AUTHORS_LENGTH) {
		return [
			{
				field: "otherAuthors",
				message: `Los otros autores no pueden superar ${MAX_OTHER_AUTHORS_LENGTH} caracteres`,
			},
		];
	}
	return [];
}

export function validateCreateResource(body: unknown): ValidationResult {
	const errors: ValidationError[] = [];
	if (!body || typeof body !== "object") {
		return {
			valid: false,
			errors: [
				{ field: "body", message: "El cuerpo de la petición es obligatorio" },
			],
		};
	}
	const b = body as Record<string, unknown>;

	if (!isNonEmptyString(b.title)) {
		errors.push({ field: "title", message: "El título es obligatorio" });
	} else if (b.title.length > 500) {
		errors.push({
			field: "title",
			message: "El título no puede superar 500 caracteres",
		});
	}

	if (!isNonEmptyString(b.description)) {
		errors.push({
			field: "description",
			message: "La descripción es obligatoria",
		});
	} else if (b.description.length > 5000) {
		errors.push({
			field: "description",
			message: "La descripción no puede superar 5000 caracteres",
		});
	}

	if (!isNonEmptyString(b.language)) {
		errors.push({ field: "language", message: "El idioma es obligatorio" });
	} else if (
		!VALID_LANGUAGES.includes(b.language as (typeof VALID_LANGUAGES)[number])
	) {
		errors.push({
			field: "language",
			message: `Idioma no válido. Valores permitidos: ${VALID_LANGUAGES.join(", ")}`,
		});
	}

	if (!isNonEmptyString(b.license)) {
		errors.push({ field: "license", message: "La licencia es obligatoria" });
	} else if (
		!VALID_LICENSES.includes(b.license as (typeof VALID_LICENSES)[number])
	) {
		errors.push({
			field: "license",
			message: `Licencia no válida. Valores permitidos: ${VALID_LICENSES.join(", ")}`,
		});
	}

	if (!isNonEmptyString(b.resourceType)) {
		errors.push({
			field: "resourceType",
			message: "El tipo de recurso es obligatorio",
		});
	}

	if (b.author !== undefined && typeof b.author !== "string") {
		errors.push({ field: "author", message: "El autor debe ser texto" });
	} else if (!isNonEmptyString(b.author)) {
		errors.push({ field: "author", message: "El autor es obligatorio" });
	} else if (b.author.length > 500) {
		errors.push({
			field: "author",
			message: "El autor no puede superar 500 caracteres",
		});
	}

	errors.push(...validateOtherAuthors(b.otherAuthors));

	if (b.keywords !== undefined && typeof b.keywords !== "string") {
		errors.push({
			field: "keywords",
			message: "Las palabras clave deben ser texto",
		});
	} else if (typeof b.keywords === "string" && b.keywords.length > 1000) {
		errors.push({
			field: "keywords",
			message: "Las palabras clave no pueden superar 1000 caracteres",
		});
	}

	if (b.publisher !== undefined && typeof b.publisher !== "string") {
		errors.push({ field: "publisher", message: "El editor debe ser texto" });
	}

	if (b.subjects !== undefined && !isStringArray(b.subjects)) {
		errors.push({
			field: "subjects",
			message: "Las materias deben ser un array de texto",
		});
	}

	if (b.levels !== undefined && !isStringArray(b.levels)) {
		errors.push({
			field: "levels",
			message: "Los niveles deben ser un array de texto",
		});
	}

	if (b.educationalAreas !== undefined) {
		errors.push(...validateEducationalAssignments(b.educationalAreas));
	}

	return { valid: errors.length === 0, errors };
}

/** Estados que exigen el recurso completo (issue #408). */
const STATUSES_REQUIRING_COMPLETE_RESOURCE: readonly string[] = [
	"review",
	"published",
];

/** Campos que el alta exige y que se vuelven a comprobar al cambiar de estado. */
const REQUIRED_RESOURCE_FIELDS = [
	"title",
	"description",
	"language",
	"license",
	"resourceType",
	"author",
] as const;

/**
 * Comprueba un recurso guardado antes de pasarlo a `status` (issue #408).
 * `review` y `published` exigen lo mismo que el alta; `draft` y `archived`,
 * nada. Las reglas propias de la publicación (p. ej. el área obligatoria
 * acordada en #448) se añaden aquí, a continuación de las del alta.
 */
export function validateResourceForStatus(
	resource: Partial<Record<(typeof REQUIRED_RESOURCE_FIELDS)[number], unknown>>,
	status: string,
): ValidationResult {
	if (!STATUSES_REQUIRING_COMPLETE_RESOURCE.includes(status)) {
		return { valid: true, errors: [] };
	}
	const payload: Record<string, unknown> = {};
	for (const field of REQUIRED_RESOURCE_FIELDS) {
		payload[field] = resource[field] ?? undefined;
	}
	return validateCreateResource(payload);
}

export function validateUpdateResource(body: unknown): ValidationResult {
	const errors: ValidationError[] = [];
	if (!body || typeof body !== "object") {
		return {
			valid: false,
			errors: [
				{ field: "body", message: "El cuerpo de la petición es obligatorio" },
			],
		};
	}
	const b = body as Record<string, unknown>;
	const updatableFields = [
		"title",
		"description",
		"language",
		"license",
		"resourceType",
		"author",
		"otherAuthors",
		"keywords",
		"publisher",
		"keywordIds",
		"educationalAreas",
	];
	const hasAtLeastOne = updatableFields.some((f) => b[f] !== undefined);
	if (!hasAtLeastOne) {
		return {
			valid: false,
			errors: [
				{
					field: "body",
					message: "Se requiere al menos un campo para actualizar",
				},
			],
		};
	}

	if (b.title !== undefined) {
		if (!isNonEmptyString(b.title)) {
			errors.push({
				field: "title",
				message: "El título no puede estar vacío",
			});
		} else if (b.title.length > 500) {
			errors.push({
				field: "title",
				message: "El título no puede superar 500 caracteres",
			});
		}
	}

	if (b.description !== undefined) {
		if (!isNonEmptyString(b.description)) {
			errors.push({
				field: "description",
				message: "La descripción no puede estar vacía",
			});
		} else if (b.description.length > 5000) {
			errors.push({
				field: "description",
				message: "La descripción no puede superar 5000 caracteres",
			});
		}
	}

	if (b.language !== undefined) {
		if (!isNonEmptyString(b.language)) {
			errors.push({
				field: "language",
				message: "El idioma no puede estar vacío",
			});
		} else if (
			!VALID_LANGUAGES.includes(b.language as (typeof VALID_LANGUAGES)[number])
		) {
			errors.push({
				field: "language",
				message: `Idioma no válido. Valores permitidos: ${VALID_LANGUAGES.join(", ")}`,
			});
		}
	}

	if (b.license !== undefined) {
		if (!isNonEmptyString(b.license)) {
			errors.push({
				field: "license",
				message: "La licencia no puede estar vacía",
			});
		} else if (
			!VALID_LICENSES.includes(b.license as (typeof VALID_LICENSES)[number])
		) {
			errors.push({
				field: "license",
				message: `Licencia no válida. Valores permitidos: ${VALID_LICENSES.join(", ")}`,
			});
		}
	}

	if (b.resourceType !== undefined && !isNonEmptyString(b.resourceType)) {
		errors.push({
			field: "resourceType",
			message: "El tipo de recurso no puede estar vacío",
		});
	}

	if (b.author !== undefined) {
		if (typeof b.author !== "string") {
			errors.push({ field: "author", message: "El autor debe ser texto" });
		} else if (!isNonEmptyString(b.author)) {
			errors.push({
				field: "author",
				message: "El autor no puede estar vacío",
			});
		} else if (b.author.length > 500) {
			errors.push({
				field: "author",
				message: "El autor no puede superar 500 caracteres",
			});
		}
	}

	errors.push(...validateOtherAuthors(b.otherAuthors));

	if (b.educationalAreas !== undefined) {
		errors.push(...validateEducationalAssignments(b.educationalAreas));
	}

	return { valid: errors.length === 0, errors };
}

export const ROLE_LEVELS: Record<string, number> = {
	reader: 0,
	author: 1,
	editor: 2,
	curator: 3,
	admin: 4,
} as const;

export function hasMinRole(
	role: string | null | undefined,
	minRole: keyof typeof ROLE_LEVELS,
) {
	return (ROLE_LEVELS[role ?? "reader"] ?? 0) >= (ROLE_LEVELS[minRole] ?? 0);
}

export function canManageResource(
	user: { id: string; role?: string | null },
	resource: {
		createdBy?: string | null;
		assignedCuratorId?: string | null;
		editorialStatus?: string | null;
	},
) {
	if (hasMinRole(user.role, "admin")) return true;
	// El creador siempre puede gestionar su propio recurso, en cualquier estado
	// (DEF-221: un curator que crea un recurso debe poder ver/editar su borrador).
	if (hasMinRole(user.role, "author") && resource.createdBy === user.id) {
		return true;
	}
	// Un curator gestiona la cola de curación (recursos en revisión) y, además,
	// cualquier recurso que él mismo haya curado. Al cambiar el estado de un recurso
	// desde "review" queda registrado como assignedCuratorId (ver updateEditorialStatus),
	// por lo que debe conservar el acceso aunque el recurso ya no esté en revisión
	// (DEF-009 / #205: antes pasaba a "recurso no encontrado" tras publicarlo/devolverlo a borrador).
	if (hasMinRole(user.role, "curator")) {
		return (
			resource.editorialStatus === "review" ||
			resource.assignedCuratorId === user.id
		);
	}
	return false;
}

export const TRANSITION_RULES: Record<
	string,
	{ to: EditorialStatus; minRole: string }[]
> = {
	draft: [
		{ to: "review", minRole: "author" },
		{ to: "published", minRole: "editor" },
	],
	review: [
		{ to: "draft", minRole: "curator" },
		{ to: "published", minRole: "curator" },
	],
	published: [{ to: "archived", minRole: "curator" }],
	archived: [{ to: "draft", minRole: "curator" }],
};

export function validateTransition(
	currentStatus: string,
	newStatus: string,
	userRole: string,
): ValidationResult {
	const rules = TRANSITION_RULES[currentStatus];
	if (!rules) {
		return {
			valid: false,
			errors: [
				{
					field: "status",
					message: `Estado actual no válido: ${currentStatus}`,
				},
			],
		};
	}
	const rule = rules.find((r) => r.to === newStatus);
	if (!rule) {
		return {
			valid: false,
			errors: [
				{
					field: "status",
					message: `Transición no permitida: ${currentStatus} → ${newStatus}`,
				},
			],
		};
	}
	const userLevel = ROLE_LEVELS[userRole] ?? -1;
	const minLevel = ROLE_LEVELS[rule.minRole] ?? 99;
	if (userLevel < minLevel) {
		return {
			valid: false,
			errors: [
				{
					field: "status",
					message: `Rol insuficiente para esta transición. Se requiere: ${rule.minRole}`,
				},
			],
		};
	}
	return { valid: true, errors: [] };
}

export function validateCollection(body: unknown): ValidationResult {
	const errors: ValidationError[] = [];
	if (!body || typeof body !== "object") {
		return {
			valid: false,
			errors: [
				{ field: "body", message: "El cuerpo de la petición es obligatorio" },
			],
		};
	}
	const b = body as Record<string, unknown>;
	if (!isNonEmptyString(b.title)) {
		errors.push({ field: "title", message: "El título es obligatorio" });
	} else if (b.title.length > 500) {
		errors.push({
			field: "title",
			message: "El título no puede superar 500 caracteres",
		});
	}
	if (!isNonEmptyString(b.description)) {
		errors.push({
			field: "description",
			message: "La descripción es obligatoria",
		});
	} else if (b.description.length > 5000) {
		errors.push({
			field: "description",
			message: "La descripción no puede superar 5000 caracteres",
		});
	}
	if (
		b.coverImageUrl !== undefined &&
		b.coverImageUrl !== null &&
		typeof b.coverImageUrl !== "string"
	) {
		errors.push({
			field: "coverImageUrl",
			message: "La imagen de portada debe ser una URL en texto",
		});
	} else if (
		typeof b.coverImageUrl === "string" &&
		b.coverImageUrl.length > 2000
	) {
		errors.push({
			field: "coverImageUrl",
			message: "La URL de portada no puede superar 2000 caracteres",
		});
	}
	return { valid: errors.length === 0, errors };
}

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateTaxonomy(body: unknown): ValidationResult {
	const errors: ValidationError[] = [];
	if (!body || typeof body !== "object") {
		return {
			valid: false,
			errors: [
				{ field: "body", message: "El cuerpo de la petición es obligatorio" },
			],
		};
	}
	const b = body as Record<string, unknown>;
	if (!isNonEmptyString(b.name)) {
		errors.push({ field: "name", message: "El nombre es obligatorio" });
	}
	if (
		b.type !== undefined &&
		isNonEmptyString(b.type) &&
		!VALID_TAXONOMY_TYPES.includes(b.type as TaxonomyType)
	) {
		errors.push({
			field: "type",
			message: `Tipo no válido. Valores permitidos: ${VALID_TAXONOMY_TYPES.join(", ")}`,
		});
	}
	if (b.parentId !== undefined && b.parentId !== null && b.parentId !== "") {
		if (typeof b.parentId !== "string" || !UUID_RE.test(b.parentId)) {
			errors.push({
				field: "parentId",
				message: "El ID del padre debe ser un UUID válido",
			});
		}
	}
	return { valid: errors.length === 0, errors };
}

export function validateStatus(status: unknown): ValidationResult {
	if (!isNonEmptyString(status)) {
		return {
			valid: false,
			errors: [{ field: "status", message: "El estado es obligatorio" }],
		};
	}
	if (!VALID_STATUSES.includes(status as EditorialStatus)) {
		return {
			valid: false,
			errors: [
				{
					field: "status",
					message: `Estado no válido. Valores permitidos: ${VALID_STATUSES.join(", ")}`,
				},
			],
		};
	}
	return { valid: true, errors: [] };
}
