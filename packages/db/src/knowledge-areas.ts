/**
 * Áreas de conocimiento y familias profesionales (issue #448, ADR-0045).
 *
 * - Los 9 bloques son fijos: agrupan visualmente, no se asignan a recursos.
 * - Las áreas viven en la tabla `knowledge_areas` (admin y curator las crean,
 *   editan y desactivan). Este fichero solo fija el catálogo inicial.
 * - Las familias profesionales son una lista oficial cerrada en código.
 * Solo en castellano por ahora.
 */

import { normalizeKeywordKey } from "./tags/keyword-catalog.ts";

export const MAX_KNOWLEDGE_AREAS = 3;
export const KNOWLEDGE_AREA_LABEL_MAX = 120;
export const KNOWLEDGE_AREA_DESCRIPTION_MAX = 1000;

export interface KnowledgeAreaBlock {
	id: string;
	label: string;
}

export const KNOWLEDGE_AREA_BLOCKS: readonly KnowledgeAreaBlock[] = [
	{ id: "artes", label: "Artes y expresión artística" },
	{ id: "ciencias", label: "Ciencias, matemáticas y tecnología" },
	{ id: "humanidades", label: "Humanidades y ciencias sociales" },
	{ id: "educacion-fisica", label: "Educación física y deporte" },
	{ id: "lenguas", label: "Lenguas y literatura" },
	{ id: "lenguas-extranjeras", label: "Lenguas extranjeras" },
	{ id: "transversales", label: "Temas transversales" },
	{ id: "empresa", label: "Empresa y orientación profesional" },
	{ id: "inclusion", label: "Inclusión educativa, tutoría y valores" },
];

export interface KnowledgeAreaSeed {
	id: string;
	label: string;
	blockId: string;
}

/** Catálogo inicial de #448, más Química (acordado el 23/10). */
export const KNOWLEDGE_AREA_SEED: readonly KnowledgeAreaSeed[] = [
	{ id: "artes-escenicas", label: "Artes Escénicas", blockId: "artes" },
	{ id: "artes-plasticas", label: "Artes Plásticas", blockId: "artes" },
	{ id: "artesania", label: "Artesanía", blockId: "artes" },
	{
		id: "diseno-y-artes-graficas",
		label: "Diseño y Artes Gráficas",
		blockId: "artes",
	},
	{ id: "musica", label: "Música", blockId: "artes" },
	{ id: "cultura-audiovisual", label: "Cultura Audiovisual", blockId: "artes" },
	{
		id: "ciencias-de-la-naturaleza",
		label: "Ciencias de la Naturaleza",
		blockId: "ciencias",
	},
	{ id: "astronomia", label: "Astronomía", blockId: "ciencias" },
	{ id: "biologia", label: "Biología", blockId: "ciencias" },
	{ id: "fisica", label: "Física", blockId: "ciencias" },
	{ id: "geologia", label: "Geología", blockId: "ciencias" },
	{ id: "quimica", label: "Química", blockId: "ciencias" },
	{ id: "matematicas", label: "Matemáticas", blockId: "ciencias" },
	{
		id: "informatica-y-pensamiento-computacional",
		label: "Informática y Pensamiento Computacional",
		blockId: "ciencias",
	},
	{
		id: "inteligencia-artificial",
		label: "Inteligencia Artificial",
		blockId: "ciencias",
	},
	{ id: "robotica", label: "Robótica", blockId: "ciencias" },
	{ id: "tecnologia", label: "Tecnología", blockId: "ciencias" },
	{
		id: "ciencias-sociales",
		label: "Ciencias Sociales",
		blockId: "humanidades",
	},
	{ id: "cultura-clasica", label: "Cultura Clásica", blockId: "humanidades" },
	{ id: "economia", label: "Economía", blockId: "humanidades" },
	{ id: "filosofia", label: "Filosofía", blockId: "humanidades" },
	{ id: "geografia", label: "Geografía", blockId: "humanidades" },
	{ id: "historia", label: "Historia", blockId: "humanidades" },
	{ id: "psicologia", label: "Psicología", blockId: "humanidades" },
	{ id: "religiones", label: "Religiones", blockId: "humanidades" },
	{
		id: "educacion-fisica-y-deporte",
		label: "Educación Física y Deporte",
		blockId: "educacion-fisica",
	},
	{
		id: "lengua-espanola-y-literatura",
		label: "Lengua Española y Literatura",
		blockId: "lenguas",
	},
	{
		id: "catalan-valenciano",
		label: "Catalán / Valenciano",
		blockId: "lenguas",
	},
	{ id: "euskera", label: "Euskera", blockId: "lenguas" },
	{ id: "gallego", label: "Gallego", blockId: "lenguas" },
	{ id: "lenguas-clasicas", label: "Lenguas Clásicas", blockId: "lenguas" },
	{
		id: "literatura-universal",
		label: "Literatura Universal",
		blockId: "lenguas",
	},
	{ id: "ingles", label: "Inglés", blockId: "lenguas-extranjeras" },
	{ id: "frances", label: "Francés", blockId: "lenguas-extranjeras" },
	{ id: "aleman", label: "Alemán", blockId: "lenguas-extranjeras" },
	{
		id: "otras-lenguas-extranjeras",
		label: "Otras Lenguas Extranjeras",
		blockId: "lenguas-extranjeras",
	},
	{
		id: "educacion-ambiental-y-sostenibilidad",
		label: "Educación Ambiental y Sostenibilidad",
		blockId: "transversales",
	},
	{
		id: "educacion-intercultural",
		label: "Educación Intercultural",
		blockId: "transversales",
	},
	{
		id: "educacion-para-el-consumo-responsable",
		label: "Educación para el Consumo Responsable",
		blockId: "transversales",
	},
	{
		id: "educacion-para-la-salud",
		label: "Educación para la Salud",
		blockId: "transversales",
	},
	{
		id: "educacion-sexual-y-afectiva",
		label: "Educación Sexual y Afectiva",
		blockId: "transversales",
	},
	{ id: "educacion-vial", label: "Educación Vial", blockId: "transversales" },
	{
		id: "competencia-digital-y-alfabetizacion-mediatica",
		label: "Competencia Digital y Alfabetización Mediática",
		blockId: "transversales",
	},
	{ id: "ajedrez", label: "Ajedrez", blockId: "transversales" },
	{ id: "efemerides", label: "Efemérides", blockId: "transversales" },
	{
		id: "empresa-y-emprendimiento",
		label: "Empresa y Emprendimiento",
		blockId: "empresa",
	},
	{
		id: "formacion-y-orientacion-laboral",
		label: "Formación y Orientación Laboral",
		blockId: "empresa",
	},
	{
		id: "orientacion-academica-y-profesional",
		label: "Orientación Académica y Profesional",
		blockId: "empresa",
	},
	{
		id: "inclusion-educativa",
		label: "Inclusión Educativa",
		blockId: "inclusion",
	},
	{ id: "patios-inclusivos", label: "Patios Inclusivos", blockId: "inclusion" },
	{
		id: "ele",
		label: "ELE (Español como Lengua Extranjera)",
		blockId: "inclusion",
	},
	{ id: "tutoria", label: "Tutoría", blockId: "inclusion" },
	{
		id: "educacion-civica-y-etica",
		label: "Educación Cívica y Ética",
		blockId: "inclusion",
	},
	{
		id: "igualdad-y-coeducacion",
		label: "Igualdad y Coeducación",
		blockId: "inclusion",
	},
	{
		id: "educacion-para-la-paz-y-la-convivencia",
		label: "Educación para la Paz y la Convivencia",
		blockId: "inclusion",
	},
	{
		id: "pedagogia-y-practica-docente",
		label: "Pedagogía y Práctica Docente",
		blockId: "inclusion",
	},
];

export interface ProfessionalFamily {
	id: string;
	label: string;
}

/** Familias profesionales oficiales de FP. Se actualizan con un cambio de código. */
export const PROFESSIONAL_FAMILIES: readonly ProfessionalFamily[] = [
	{
		id: "actividades-fisicas-y-deportivas",
		label: "Actividades Físicas y Deportivas",
	},
	{
		id: "actividades-y-competencias-transversales",
		label: "Actividades y Competencias Transversales",
	},
	{ id: "administracion-y-gestion", label: "Administración y Gestión" },
	{ id: "agraria", label: "Agraria" },
	{ id: "artes-graficas", label: "Artes Gráficas" },
	{ id: "artes-y-artesanias", label: "Artes y Artesanías" },
	{ id: "comercio-y-marketing", label: "Comercio y Marketing" },
	{ id: "edificacion-y-obra-civil", label: "Edificación y Obra Civil" },
	{ id: "electricidad-y-electronica", label: "Electricidad y Electrónica" },
	{ id: "energia-y-agua", label: "Energía y Agua" },
	{ id: "fabricacion-mecanica", label: "Fabricación Mecánica" },
	{ id: "hosteleria-y-turismo", label: "Hostelería y Turismo" },
	{ id: "imagen-personal", label: "Imagen Personal" },
	{ id: "imagen-y-sonido", label: "Imagen y Sonido" },
	{ id: "industrias-alimentarias", label: "Industrias Alimentarias" },
	{ id: "industrias-extractivas", label: "Industrias Extractivas" },
	{ id: "informatica-y-comunicaciones", label: "Informática y Comunicaciones" },
	{ id: "instalacion-y-mantenimiento", label: "Instalación y Mantenimiento" },
	{
		id: "inteligencia-artificial-y-data",
		label: "Inteligencia Artificial y Data",
	},
	{ id: "madera-mueble-y-corcho", label: "Madera, Mueble y Corcho" },
	{ id: "maritimo-pesquera", label: "Marítimo-Pesquera" },
	{ id: "quimica", label: "Química" },
	{ id: "sanidad", label: "Sanidad" },
	{ id: "seguridad-y-medio-ambiente", label: "Seguridad y Medio Ambiente" },
	{
		id: "servicios-socioculturales-y-a-la-comunidad",
		label: "Servicios Socioculturales y a la Comunidad",
	},
	{ id: "textil-confeccion-y-piel", label: "Textil, Confección y Piel" },
	{
		id: "transporte-y-mantenimiento-de-vehiculos",
		label: "Transporte y Mantenimiento de Vehículos",
	},
	{ id: "vidrio-y-ceramica", label: "Vidrio y Cerámica" },
];

/** Categoría de la categorización educativa (#380) que habilita las familias. */
export const PROFESSIONAL_FAMILY_CATEGORY_ID = "formacion-profesional";

/** Campos del alta y la edición del recurso (y de sus errores de validación). */
export const KNOWLEDGE_AREA_FIELD = "knowledgeAreaIds";
export const PROFESSIONAL_FAMILY_FIELD = "professionalFamilyIds";

export const KNOWLEDGE_AREA_MESSAGES = {
	labelRequired: "La denominación es obligatoria",
	labelTooLong: `La denominación no puede superar ${KNOWLEDGE_AREA_LABEL_MAX} caracteres`,
	descriptionTooLong: `La descripción no puede superar ${KNOWLEDGE_AREA_DESCRIPTION_MAX} caracteres`,
	unknownBlock: "El bloque no existe",
	duplicate: "Ya existe un área con esa denominación",
	notFound: "Área de conocimiento no encontrada",
	invalidList:
		"Las áreas de conocimiento deben ser una lista de identificadores",
	duplicateSelection: "No se admiten áreas repetidas en el mismo recurso",
	max: `Puedes seleccionar como máximo ${MAX_KNOWLEDGE_AREAS} áreas de conocimiento`,
	unknownArea: "Alguna área de conocimiento no existe",
	inactiveArea: "Alguna área de conocimiento está desactivada",
	invalidFamilyList:
		"Las familias profesionales deben ser una lista de identificadores",
	duplicateFamily: "No se admiten familias profesionales repetidas",
	unknownFamily: "Alguna familia profesional no existe",
	familyRequiresFp:
		"Las familias profesionales solo se guardan en recursos de Formación Profesional",
	required: "Selecciona al menos un área de conocimiento",
	requiredWhilePublished:
		"Un recurso en revisión o publicado necesita al menos un área de conocimiento",
} as const;

/** Clave para comparar denominaciones: sin mayúsculas, tildes ni espacios extra. */
export function normalizeKnowledgeAreaKey(value: string): string {
	return normalizeKeywordKey(value);
}

export function isKnowledgeAreaBlock(id: unknown): id is string {
	return (
		typeof id === "string" &&
		KNOWLEDGE_AREA_BLOCKS.some((block) => block.id === id)
	);
}

export function isProfessionalFamily(id: unknown): id is string {
	return (
		typeof id === "string" &&
		PROFESSIONAL_FAMILIES.some((family) => family.id === id)
	);
}

export type KnowledgeAreaInput = {
	label?: unknown;
	description?: unknown;
	blockId?: unknown;
};

export type KnowledgeAreaFields = {
	label?: string;
	description?: string | null;
	blockId?: string;
};

/**
 * Valida el alta (`partial = false`) o la edición (`partial = true`) de un
 * área. Devuelve los campos limpios o el primer error.
 */
export function validateKnowledgeAreaInput(
	input: KnowledgeAreaInput,
	partial = false,
): { ok: true; value: KnowledgeAreaFields } | { ok: false; message: string } {
	const value: KnowledgeAreaFields = {};
	if (input.label !== undefined || !partial) {
		const label =
			typeof input.label === "string"
				? input.label.trim().replace(/\s+/g, " ")
				: "";
		if (!label)
			return { ok: false, message: KNOWLEDGE_AREA_MESSAGES.labelRequired };
		if (label.length > KNOWLEDGE_AREA_LABEL_MAX) {
			return { ok: false, message: KNOWLEDGE_AREA_MESSAGES.labelTooLong };
		}
		value.label = label;
	}
	if (input.description !== undefined) {
		if (input.description !== null && typeof input.description !== "string") {
			return { ok: false, message: KNOWLEDGE_AREA_MESSAGES.descriptionTooLong };
		}
		const description = input.description?.trim() || null;
		if (description && description.length > KNOWLEDGE_AREA_DESCRIPTION_MAX) {
			return { ok: false, message: KNOWLEDGE_AREA_MESSAGES.descriptionTooLong };
		}
		value.description = description;
	}
	if (input.blockId !== undefined || !partial) {
		if (!isKnowledgeAreaBlock(input.blockId)) {
			return { ok: false, message: KNOWLEDGE_AREA_MESSAGES.unknownBlock };
		}
		value.blockId = input.blockId;
	}
	return { ok: true, value };
}

/** Lista de ids sin repetir y como máximo {@link MAX_KNOWLEDGE_AREAS}. */
export function validateKnowledgeAreaSelection(
	ids: unknown,
): { ok: true; ids: string[] } | { ok: false; message: string } {
	if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
		return { ok: false, message: KNOWLEDGE_AREA_MESSAGES.invalidList };
	}
	if (new Set(ids).size !== ids.length) {
		return { ok: false, message: KNOWLEDGE_AREA_MESSAGES.duplicateSelection };
	}
	if (ids.length > MAX_KNOWLEDGE_AREAS) {
		return { ok: false, message: KNOWLEDGE_AREA_MESSAGES.max };
	}
	return { ok: true, ids };
}

/** Familias de la lista oficial y sin repetir, sin mirar la categorización. */
export function validateProfessionalFamilyList(
	ids: unknown,
): { ok: true; ids: string[] } | { ok: false; message: string } {
	if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
		return { ok: false, message: KNOWLEDGE_AREA_MESSAGES.invalidFamilyList };
	}
	if (new Set(ids).size !== ids.length) {
		return { ok: false, message: KNOWLEDGE_AREA_MESSAGES.duplicateFamily };
	}
	if (!ids.every(isProfessionalFamily)) {
		return { ok: false, message: KNOWLEDGE_AREA_MESSAGES.unknownFamily };
	}
	return { ok: true, ids };
}

/**
 * Familias de la lista oficial, sin repetir, y solo si el recurso está
 * clasificado en Formación Profesional.
 */
export function validateProfessionalFamilySelection(
	ids: unknown,
	categoryIds: readonly string[],
): { ok: true; ids: string[] } | { ok: false; message: string } {
	const list = validateProfessionalFamilyList(ids);
	if (!list.ok) return list;
	if (
		list.ids.length > 0 &&
		!categoryIds.includes(PROFESSIONAL_FAMILY_CATEGORY_ID)
	) {
		return { ok: false, message: KNOWLEDGE_AREA_MESSAGES.familyRequiresFp };
	}
	return list;
}

/** Ids de categoría de una categorización educativa sin validar. */
export function educationalCategoryIdsOf(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((item) =>
			item && typeof item === "object"
				? (item as { categoryId?: unknown }).categoryId
				: undefined,
		)
		.filter((id): id is string => typeof id === "string");
}

/**
 * Lista de ids de un parámetro de búsqueda (`quimica,fisica`): sin vacíos ni
 * repetidos. Los ids desconocidos no se descartan aquí: no dan resultados.
 */
export function parseCatalogIdList(raw: string | null | undefined): string[] {
	if (!raw) return [];
	const ids = raw
		.split(",")
		.map((id) => id.trim())
		.filter(Boolean);
	return [...new Set(ids)];
}

function sqlString(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Palabras clave del catálogo inicial (#397) que se parecen a un área sin
 * tener la misma denominación. No se retiran solas: salen en el informe del
 * cruce para que producto decida (#384, #448). Las de denominación idéntica
 * se detectan comparando etiquetas normalizadas, no con esta tabla.
 */
export const KEYWORD_AREA_REVIEW_CANDIDATES: Readonly<
	Record<string, readonly string[]>
> = {
	"lengua-y-literatura": ["lengua-espanola-y-literatura"],
	"lenguas-extranjeras": [
		"ingles",
		"frances",
		"aleman",
		"otras-lenguas-extranjeras",
	],
	"alfabetizacion-mediatica": [
		"competencia-digital-y-alfabetizacion-mediatica",
	],
	"competencia-digital": ["competencia-digital-y-alfabetizacion-mediatica"],
	informatica: ["informatica-y-pensamiento-computacional"],
	"programacion-y-pensamiento-computacional": [
		"informatica-y-pensamiento-computacional",
	],
	"medio-ambiente-y-sostenibilidad": ["educacion-ambiental-y-sostenibilidad"],
	"artes-plasticas-y-visuales": ["artes-plasticas"],
	"economia-y-emprendimiento": ["economia", "empresa-y-emprendimiento"],
	"filosofia-y-etica": ["filosofia", "educacion-civica-y-etica"],
	"ciudadania-y-derechos-humanos": ["educacion-civica-y-etica"],
	interculturalidad: ["educacion-intercultural"],
	"salud-y-habitos-saludables": ["educacion-para-la-salud"],
	"inclusion-y-atencion-a-la-diversidad": ["inclusion-educativa"],
	"convivencia-y-prevencion-del-acoso": [
		"educacion-para-la-paz-y-la-convivencia",
	],
	"desarrollo-profesional-docente": ["pedagogia-y-practica-docente"],
};

/**
 * Siembra idempotente del catálogo inicial. Va igual en la migración 0014 y
 * en setup.ts (un test comprueba que coinciden). No pisa áreas editadas ni
 * choca con un área creada a mano con la misma denominación.
 */
export const KNOWLEDGE_AREA_SEED_SQL = `INSERT INTO knowledge_areas (id, label, block_id, position)
VALUES
${KNOWLEDGE_AREA_SEED.map(
	(area, index) =>
		`	(${sqlString(area.id)}, ${sqlString(area.label)}, ${sqlString(area.blockId)}, ${index})`,
).join(",\n")}
ON CONFLICT DO NOTHING`;
