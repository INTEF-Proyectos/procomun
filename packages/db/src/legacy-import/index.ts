export { mapLegacyRecord, resolveLegacyExternalId } from "./field-mapper.ts";
export type { LanguageNormalizationResult } from "./normalize-language.ts";
export { normalizeLanguage } from "./normalize-language.ts";
export type {
	LicenseCode,
	LicenseNormalizationResult,
} from "./normalize-license.ts";
export { normalizeLicense } from "./normalize-license.ts";
export type { ResourceTypeMappingResult } from "./resource-type-map.ts";
export { mapResourceType } from "./resource-type-map.ts";
export {
	ensureLegacyImportSystemUser,
	LEGACY_IMPORT_SYSTEM_USER_EMAIL,
	LEGACY_IMPORT_SYSTEM_USER_ID,
} from "./system-user.ts";
export type {
	LegacyOdeJson,
	MappedLegacyResource,
	MappingResult,
	MappingWarning,
} from "./types.ts";
