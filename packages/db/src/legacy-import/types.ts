import type { LegacyEditorialStatus } from "./publication-status.ts";

/**
 * Forma observada del JSON de metadatos exportado por la plataforma legacy
 * Procomún (ver ode-export/, no versionado, y docs/epics/epic-004-migracion-legacy-procomun/).
 * Todos los campos son opcionales/nullable porque el esquema no está documentado
 * oficialmente (ADR-0029): se ha inferido de 9 ejemplos reales.
 */
export interface LegacyOdeJson {
	id?: string | null;
	idODE?: string | null;
	titleStr?: string | null;
	type?: string | null;
	published?: string | number | null;
	certified?: number | null;
	mecIdentifierStr?: string | null;
	descriptionStr?: string | null;
	publicatorStr?: string | null;
	publicatorNameStr?: string | null;
	publicatorEmailStr?: string | null;
	knowledgeArea?: string[] | null;
	learningContext?: string[] | null;
	resourceType?: string[] | null;
	publicationDate?: string | null;
	lastIndexDate?: string | null;
	fechaRegistro?: string | null;
	labelsStr?: string[] | null;
	generalIdentifierStr?: string[] | null;
	educationalLearningResourceTypeStr?: string[] | null;
	educationalIntendedEndUserRoleStr?: string[] | null;
	educationalContextStr?: string[] | null;
	educationalCognitiveProcess?: unknown;
	educationalDescriptionStr?: string[] | null;
	educationalDescription?: string[] | null;
	educationalLanguageStr?: string[] | null;
	rightsCopyrightAndOtherRestrictionsStr?: string | null;
	rightsAccessStr?: string | null;
	rightsAccessDescriptionStr?: string | null;
	lifecycleContributeStr?: string[] | null;
	generalAggregationLevelStr?: string | null;
	generalLanguageStr?: string[] | null;
	generateId?: string | null;
	nodoPublicacion?: string | null;
	odeNode?: string | null;
	rutaAccesoContenidos?: string | null;
	technicalLocationStr?: string | null;
	editores?: unknown;
	metadatosLOMES?: unknown;
	estado?: string | null;
	authorStr?: string[] | null;
	collectionNameStr?: string[] | null;
	idDrupal?: string | null;
	/** URL de la miniatura que publicaba el catálogo legacy (`vistaPreviaAgrega.png`). */
	preview?: string | null;
}

export interface MappingWarning {
	field: string;
	message: string;
}

export interface MappedLegacyResource {
	externalId: string;
	importSource: "legacy-procomun";
	sourceUri: string | null;
	title: string;
	description: string;
	language: string;
	/** null solo cuando la licencia no pudo normalizarse (ver MappingResult.blocking) */
	license: string | null;
	resourceType: string;
	subjects: string[];
	levels: string[];
	author: string | null;
	publisher: string | null;
	keywords: string | null;
	importedAt: Date | null;
	/** URL http(s) de la miniatura, o null si el JSON no traía una usable. */
	previewImageUrl: string | null;
	/** Solo `published: 1` se publica; el resto queda en borrador (issue #447). */
	editorialStatus: LegacyEditorialStatus;
	/** Valor de `published` recibido, para el informe de importación. */
	sourcePublished: string | number | null;
	/**
	 * Visitas del Procomún antiguo (#421, ADR-0044). Pendiente: el exportador
	 * todavía no incluye el dato y aún no se sabe el nombre del campo del JSON,
	 * así que el mapper no lo rellena. Cuando exista, basta con leerlo aquí.
	 */
	legacyViewCount?: number | null;
}

export interface MappingResult {
	externalId: string;
	/** true si el registro no debe importarse (ver blockingErrors) */
	blocking: boolean;
	blockingErrors: string[];
	warnings: MappingWarning[];
	resource: MappedLegacyResource;
}
