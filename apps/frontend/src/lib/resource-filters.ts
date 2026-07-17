import { RESOURCE_TYPES } from "@procomun/db/resource-types";

export interface FilterOption {
	label: string;
	value: string;
}

// Derivado de RESOURCE_TYPES (packages/db/src/resource-types.ts), única
// fuente de verdad: antes esta lista se mantenía a mano aquí, desincronizada
// del diccionario del importador legacy y de los datos semilla (dos tipos
// reales, "guia-docente" e "infografia", no eran filtrables).
export const RESOURCE_TYPE_OPTIONS: FilterOption[] = [
	{ value: "", label: "Todos los tipos" },
	...RESOURCE_TYPES,
];

export const LANGUAGE_OPTIONS: FilterOption[] = [
	{ value: "", label: "Todos los idiomas" },
	{ value: "es", label: "Espanol" },
	{ value: "en", label: "Ingles" },
	{ value: "ca", label: "Catalan" },
	{ value: "eu", label: "Euskera" },
	{ value: "gl", label: "Gallego" },
	{ value: "fr", label: "Frances" },
	{ value: "pt", label: "Portugues" },
	{ value: "de", label: "Aleman" },
	{ value: "it", label: "Italiano" },
];

export const LICENSE_OPTIONS: FilterOption[] = [
	{ value: "", label: "Todas las licencias" },
	{ value: "cc-by", label: "CC BY" },
	{ value: "cc-by-sa", label: "CC BY-SA" },
	{ value: "cc-by-nc", label: "CC BY-NC" },
	{ value: "cc-by-nc-sa", label: "CC BY-NC-SA" },
	{ value: "cc-by-nc-nd", label: "CC BY-NC-ND" },
	{ value: "cc-by-nd", label: "CC BY-ND" },
	{ value: "cc0", label: "CC0" },
];

const cache = new Map<string, FilterOption[]>();

export async function loadFilterOptions(
	type: string,
	emptyLabel: string,
	fallback: FilterOption[],
): Promise<FilterOption[]> {
	const cached = cache.get(type);
	if (cached) return cached;
	try {
		const base =
			(window as unknown as Record<string, unknown>).__BASE_URL__ ?? "";
		const res = await fetch(`${base}api/v1/taxonomies/${type}`);
		if (!res.ok) return fallback;
		const data: { slug: string; name: string }[] = await res.json();
		const options: FilterOption[] = [
			{ value: "", label: emptyLabel },
			...data.map((t) => ({ value: t.slug, label: t.name })),
		];
		cache.set(type, options);
		return options;
	} catch {
		return fallback;
	}
}
