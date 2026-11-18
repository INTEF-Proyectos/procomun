export {
	buildLegacyArticleDescription,
	isLegacyArticle,
	LEGACY_ARTICLE_RESOURCE_TYPE,
} from "./article.ts";
export type {
	CategorizacionEducativaInforme,
	EducationalImportResourceNote,
	LegacyEducationalCategoryMapping,
	LegacyEducationalCategoryRule,
} from "./educational-category-map.ts";
export {
	assertLegacyCategoryDestinations,
	LEGACY_EDUCATIONAL_CATEGORY_RULES,
	mapLegacyEducationalCategories,
	normalizeLegacyEducationalCategory,
	summarizeLegacyEducationalImport,
} from "./educational-category-map.ts";
export {
	IMPORT_SOURCE,
	mapLegacyRecord,
	resolveLegacyExternalId,
} from "./field-mapper.ts";
export { normalizeLanguage } from "./normalize-language.ts";
export type {
	LicenseCode,
	LicenseNormalizationResult,
} from "./normalize-license.ts";
export { normalizeLicense } from "./normalize-license.ts";
export type {
	LegacyEditorialStatus,
	LegacyPublicationStatus,
} from "./publication-status.ts";
export { resolveLegacyPublicationStatus } from "./publication-status.ts";
export { normalizeLegacyPublicatorEmail } from "./publicator-email.ts";
export type { ResourceTypeMappingResult } from "./resource-type-map.ts";
export { mapResourceType } from "./resource-type-map.ts";
export {
	ensureLegacyImportSystemUser,
	LEGACY_IMPORT_SYSTEM_USER_EMAIL,
	LEGACY_IMPORT_SYSTEM_USER_ID,
} from "./system-user.ts";
export type {
	LegacyOdeJson,
	LegacyRecordKind,
	MappedLegacyResource,
	MappingResult,
	MappingWarning,
} from "./types.ts";
export type {
	LegacyUserJson,
	LegacyUserProfile,
	LegacyUserRole,
	MappedLegacyUser,
} from "./users.ts";
export {
	LEGACY_USER_ID_PREFIX,
	mapLegacyRoles,
	mapLegacyUser,
} from "./users.ts";
