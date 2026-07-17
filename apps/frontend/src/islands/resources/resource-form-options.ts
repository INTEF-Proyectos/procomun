import { RESOURCE_TYPES } from "@procomun/db/resource-types";

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

// Derived from RESOURCE_TYPES (packages/db/src/resource-types.ts), the single
// source of truth for canonical resource types.
export const RESOURCE_TYPE_OPTIONS = RESOURCE_TYPES;

export interface ResourceTypeOption {
	readonly value: string;
	readonly label: string;
}

/**
 * Returns the canonical resource types plus the current stored value when it
 * is non-empty and not canonical. This prevents an edit form from silently
 * replacing a legacy/imported value when another field is saved.
 *
 * @param currentValue Current resource type stored for the resource.
 * @return Options that preserve the current value when necessary.
 */
export function getResourceTypeOptions(
	currentValue?: string | null,
): readonly ResourceTypeOption[] {
	if (!currentValue?.trim()) {
		return RESOURCE_TYPE_OPTIONS;
	}

	if (RESOURCE_TYPE_OPTIONS.some((option) => option.value === currentValue)) {
		return RESOURCE_TYPE_OPTIONS;
	}

	return [
		{ value: currentValue, label: `${currentValue} (valor existente)` },
		...RESOURCE_TYPE_OPTIONS,
	];
}
