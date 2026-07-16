export interface ResourceTypeDefinition {
	value: string;
	label: string;
}

/**
 * Vocabulario informal de `resources.resourceType` (varchar(100) sin enum en
 * BD — ver validation.ts). Única fuente de verdad: antes de esta lista,
 * `apps/frontend/src/lib/resource-filters.ts` (opciones de filtro),
 * `packages/db/src/legacy-import/resource-type-map.ts` (diccionario del
 * importador) y `packages/db/src/seed-data.ts` (datos de ejemplo) mantenían
 * cada uno su propia lista a mano, desincronizadas entre sí — un recurso
 * podía tener un `resourceType` real que no aparecía como opción de filtro,
 * o el importador nunca asignaba un tipo que sí era filtrable. Añadir un
 * tipo nuevo aquí lo propaga a filtro y a documentación; el diccionario del
 * importador sigue siendo responsable de decidir qué texto de origen legacy
 * mapea a cada valor.
 */
export const RESOURCE_TYPES: ResourceTypeDefinition[] = [
	{ value: "documento", label: "Documento" },
	{ value: "presentacion", label: "Presentación" },
	{ value: "video", label: "Vídeo" },
	{ value: "audio", label: "Audio" },
	{ value: "imagen", label: "Imagen" },
	{ value: "actividad-interactiva", label: "Actividad interactiva" },
	{ value: "secuencia-didactica", label: "Secuencia didáctica" },
	{ value: "ejercicio", label: "Ejercicio" },
	{ value: "evaluacion", label: "Evaluación" },
	{ value: "proyecto", label: "Proyecto" },
	{ value: "guia-docente", label: "Guía docente" },
	{ value: "infografia", label: "Infografía" },
	{ value: "mapa-conceptual", label: "Mapa conceptual" },
];

export const RESOURCE_TYPE_VALUES: readonly string[] = RESOURCE_TYPES.map((t) => t.value);
