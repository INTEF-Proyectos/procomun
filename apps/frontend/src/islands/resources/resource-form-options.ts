export const LANGUAGE_OPTIONS = [
	{ value: "es", label: "Español" },
	{ value: "en", label: "Inglés" },
	{ value: "ca", label: "Catalán" },
	{ value: "eu", label: "Euskera" },
	{ value: "gl", label: "Gallego" },
] as const;

export const LICENSE_OPTIONS = [
	{ value: "cc-by", label: "CC BY" },
	{ value: "cc-by-sa", label: "CC BY-SA" },
	{ value: "cc-by-nc", label: "CC BY-NC" },
	{ value: "cc-by-nc-sa", label: "CC BY-NC-SA" },
	{ value: "cc0", label: "CC0 (Dominio público)" },
] as const;

// Derivado de RESOURCE_TYPES (packages/db/src/resource-types.ts), única
// fuente de verdad. Antes esta lista se mantenía a mano aquí, con solo 10 de
// los 13 tipos reales (sin guia-docente, infografia ni mapa-conceptual):
// editar un recurso con uno de esos tipos no mostraba ninguna opción
// seleccionada en el <select>, arriesgando que se guardase con el tipo
// equivocado (fallback del navegador) en vez de conservar el original — ver
// revisión del PR #274.
export { RESOURCE_TYPES as RESOURCE_TYPE_OPTIONS } from "@procomun/db/resource-types";
