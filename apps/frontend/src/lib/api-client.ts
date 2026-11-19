/**
 * Interfaz estable para todas las operaciones de datos del frontend.
 * Implementación actual: HttpApiClient (contra la API del servidor).
 */

/**
 * Previsualización del .elpx que la API adjunta a cada recurso. El visor y la
 * miniatura son independientes (revisión de #471): un objeto no nulo no
 * implica que haya visor. El iframe de la ficha y «Ponlo en tu web» dependen
 * de `previewUrl`; la miniatura de la tarjeta, de `screenshotUrl` o
 * `thumbnailUrl`.
 */
export interface ElpxCardPreview {
	hash: string;
	/** Visor HTML del paquete (index.html). `null` si el paquete no lo trae. */
	previewUrl: string | null;
	/** Miniatura screenshot.png de eXeLearning 4 (#409), si el paquete la trae. */
	screenshotUrl?: string | null;
	/** Miniatura generada en el servidor (#470) para los paquetes sin imagen. */
	thumbnailUrl?: string | null;
}

export interface Resource {
	id: string;
	slug: string;
	title: string;
	description: string;
	language: string | null;
	license: string;
	resourceType: string;
	keywords: string | null;
	/** Palabras clave del catálogo (ADR-0042). */
	catalogKeywords?: CatalogKeyword[];
	author: string | null;
	otherAuthors?: string | null;
	publisher: string | null;
	thumbnailUrl?: string | null;
	editorialStatus: string;
	createdBy: string | null;
	createdByName: string | null;
	/** La cuenta creadora existe y no está dada de baja (#541). */
	createdByActive?: boolean;
	assignedCuratorId?: string | null;
	createdAt: string | number | Date | null;
	updatedAt: string | number | Date | null;
	deletedAt: unknown;
	subjects?: string[];
	levels?: string[];
	educationalAreas?: { categoryId: string; optionId: string | null }[];
	/** Áreas de conocimiento (#448), también las desactivadas que conserva. */
	knowledgeAreas?: ResourceKnowledgeArea[];
	/** Familias profesionales (#448); solo en recursos de FP. */
	professionalFamilies?: { id: string; label: string }[];
	mediaItems?: MediaItemRecord[];
	elpxPreview?: ElpxCardPreview | null;
	elpxFileUrl?: string | null;
	rating?: { average: number; count: number };
	favoriteCount?: number;
	featuredAt?: string | null;
	userScore?: number;
}

export interface ResourceListResult {
	data: Resource[];
	total: number;
	limit: number;
	offset: number;
}

/** Compact card used by related / same-author recommendation strips (ADR-0036). */
export interface RelatedResource {
	id: string;
	slug: string;
	title: string;
	description: string;
	resourceType: string;
	language: string | null;
	license: string;
	author: string | null;
	editorialStatus?: string;
	score: number;
	elpxPreview?: ElpxCardPreview | null;
	signals?: {
		sharedSubjects: number;
		sharedLevels: number;
		sameResourceType: boolean;
		sameLanguage: boolean;
		sharedKeywords: number;
		sameAuthor: boolean;
		collectionCooccurrence: number;
		ftsRank: number;
	};
}

export interface RelatedResourcesResult {
	data: RelatedResource[];
	sameAuthor: RelatedResource[];
	limit: number;
}

export interface UserRecord {
	id: string;
	email: string;
	name: string | null;
	bio: string | null;
	role: string;
	isActive: boolean;
	createdAt?: string | number | Date | null;
	updatedAt?: string | number | Date | null;
}

export interface CollectionRecord {
	id: string;
	slug: string;
	title: string;
	description: string;
	coverImageUrl?: string | null;
	editorialStatus: string;
	curatorId: string;
	curatorName?: string | null;
	resourceCount?: number;
	isOrdered?: number;
	createdAt?: string | number | Date | null;
	updatedAt?: string | number | Date | null;
}

export interface CollectionResourceRecord {
	resourceId: string;
	position: number;
	title: string;
	slug: string;
	description: string;
	resourceType: string;
	language: string | null;
	license: string;
	author: string | null;
	createdBy?: string | null;
	createdByName?: string | null;
	/** La cuenta creadora existe y no está dada de baja (#541). */
	createdByActive?: boolean;
	editorialStatus: string;
	thumbnailUrl?: string | null;
	elpxPreview?: ElpxCardPreview | null;
}

export interface CollectionDetailRecord extends CollectionRecord {
	resources: CollectionResourceRecord[];
}

export interface TaxonomyRecord {
	id: string;
	slug: string;
	name: string;
	type: string;
	parentId?: string | null;
	createdAt?: string | number | Date | null;
	updatedAt?: string | number | Date | null;
}

/** Palabra clave del catálogo controlado (ADR-0042 / #384). */
export interface CatalogKeyword {
	id: string;
	slug: string;
	label: string;
}

export interface KeywordSuggestion extends CatalogKeyword {
	/** `tag`: etiqueta libre anterior (solo en el filtro del buscador). */
	match: "label" | "alias" | "tag";
}

/** Área de conocimiento del catálogo (#448, ADR-0045). */
export interface KnowledgeAreaRecord {
	id: string;
	label: string;
	description: string | null;
	blockId: string;
	position: number;
	active: boolean;
	usageCount: number;
}

/** Catálogo completo para el panel: bloques y familias son listas cerradas. */
export interface KnowledgeAreaCatalog {
	blocks: Array<{ id: string; label: string }>;
	areas: KnowledgeAreaRecord[];
	professionalFamilies: Array<{ id: string; label: string }>;
}

export interface KnowledgeAreaInput {
	label?: string;
	description?: string | null;
	blockId?: string;
	active?: boolean;
}

/** Área asociada a un recurso. `active: false` = desactivada en el catálogo. */
export interface ResourceKnowledgeArea {
	id: string;
	label: string;
	blockId: string;
	active: boolean;
}

/**
 * Catálogo público (`GET /api/v1/knowledge-areas`) para los formularios y el
 * buscador: incluye las áreas desactivadas, marcadas con `active: false`.
 */
export interface PublicKnowledgeAreaCatalog {
	blocks: Array<{ id: string; label: string }>;
	areas: ResourceKnowledgeArea[];
	professionalFamilies: Array<{ id: string; label: string }>;
}

/** Atomized educational tag (ADR-0034 / #76 / #310). */
/** Datos públicos de la cuenta que publica (#458): sin correo ni rol. */
export interface PublicAuthor {
	id: string;
	name: string | null;
	image: string | null;
}

export interface TagRecord {
	id: string;
	slug: string;
	label: string;
	description: string | null;
	usageCount: number;
	canonicalTagId: string | null;
	createdAt?: string | number | Date | null;
	updatedAt?: string | number | Date | null;
}

export interface PaginatedResult<T> {
	data: T[];
	total: number;
	limit: number;
	offset: number;
}

export interface ReportRecord {
	id: string;
	resourceId: string;
	resourceTitle?: string;
	resourceSlug?: string;
	reporterId?: string | null;
	reporterName?: string | null;
	reason: string;
	description?: string | null;
	status: string;
	moderatorId?: string | null;
	resolution?: string | null;
	actionTaken?: string | null;
	createdAt: string;
	updatedAt: string;
	resolvedAt?: string | null;
}

export interface MediaItemRecord {
	id: string;
	resourceId: string;
	type: string;
	mimeType?: string | null;
	url: string;
	fileSize?: number | null;
	filename?: string | null;
	isPrimary: number;
}

export interface UploadSessionRecord {
	id: string;
	resourceId: string;
	ownerId: string;
	mediaItemId?: string | null;
	status: string;
	originalFilename: string;
	mimeType?: string | null;
	storageKey: string;
	publicUrl?: string | null;
	checksumAlgorithm?: string | null;
	finalChecksum?: string | null;
	errorCode?: string | null;
	errorMessage?: string | null;
	declaredSize?: number | null;
	receivedBytes: number;
	expiresAt?: string | number | Date | null;
	completedAt?: string | number | Date | null;
	cancelledAt?: string | number | Date | null;
	createdAt?: string | number | Date | null;
	updatedAt?: string | number | Date | null;
}

export interface ElpxProjectInfo {
	id: string;
	hash: string;
	hasPreview: boolean;
	previewUrl: string | null;
	elpxFileUrl: string | null;
	metadata: {
		title: string;
		description: string;
		author: string;
		license: string;
		language: string;
		learningResourceType: string;
	} | null;
	originalFilename: string;
	version: number;
	createdAt: string | number | Date | null;
}

export interface UploadConfig {
	maxFileSizeBytes: number;
	maxFilesPerBatch: number;
	maxConcurrentPerUser: number;
	chunkSizeBytes: number;
	sessionTtlMs: number;
	allowedMimeTypes: string[];
	allowedExtensions: string[];
	/** Solo servidor: no se expone al cliente vía /api/admin/uploads/config. */
	storageDir?: string;
}

export interface SessionUser {
	id: string;
	email: string;
	name: string;
	role: string;
}

export interface SessionData {
	user: SessionUser;
}

export interface ApiTokenRecord {
	id: string;
	name: string;
	tokenPrefix: string;
	lastUsedAt: string | null;
	expiresAt: string | null;
	revokedAt: string | null;
	requestCount: number;
	createdAt: string;
	token?: string;
	user?: {
		id: string;
		name: string | null;
		email: string;
	};
}

export interface ApiTokenStats {
	activeCount: number;
	revokedCount: number;
	totalRequests: number;
}

export interface AppConfig {
	oidcEnabled: boolean;
	oidcEndSessionUrl: string | null;
	emailVerificationRequired: boolean;
	/** URL del banco multimedia externo (#569); `null` si no está configurada. */
	mediaBankUrl?: string | null;
	/** Hay transporte de correo; sin él se esconde la recuperación (#551). */
	emailDeliveryEnabled: boolean;
}

export interface BadgeConfig {
	novedadDays: number;
	destacadoMinRatings: number;
	destacadoMinAvg: number;
	destacadoMinFavorites: number;
}

export interface SignInResult {
	ok: boolean;
	error?: string;
	/** Código de better-auth, p. ej. `BANNED_USER` para una cuenta bloqueada. */
	code?: string;
	redirectUrl?: string;
}

export interface CreateResourceInput {
	title: string;
	description: string;
	language: string;
	license: string;
	resourceType: string;
	author?: string;
	otherAuthors?: string;
	keywords?: string;
	publisher?: string;
	subjects?: string[];
	levels?: string[];
	/** Ids del catálogo; van en el mismo alta o edición (guardado atómico). */
	keywordIds?: string[];
	educationalAreas?: { categoryId: string; optionId: string | null }[];
	/** Áreas de conocimiento (#448): como máximo 3. */
	knowledgeAreaIds?: string[];
	/** Familias profesionales (#448): solo con Formación Profesional. */
	professionalFamilyIds?: string[];
}

export type UpdateResourceInput = Partial<CreateResourceInput>;

export interface ApiClient {
	// Public
	listResources(opts?: {
		q?: string;
		limit?: number;
		offset?: number;
		resourceType?: string;
		language?: string;
		license?: string;
		tag?: string;
		educationalCategory?: string;
		educationalOption?: string;
		knowledgeAreas?: string[];
		professionalFamilies?: string[];
	}): Promise<ResourceListResult>;
	getKnowledgeAreaCatalog(): Promise<PublicKnowledgeAreaCatalog>;
	getResourceBySlug(slug: string): Promise<Resource | null>;
	getRelatedResources(
		slug: string,
		opts?: { limit?: number },
	): Promise<RelatedResourcesResult>;
	listPublicTags(opts?: {
		q?: string;
		limit?: number;
		offset?: number;
	}): Promise<PaginatedResult<TagRecord>>;
	listPopularTags(limit?: number): Promise<TagRecord[]>;
	searchKeywords(
		query: string,
		includeTags?: boolean,
	): Promise<KeywordSuggestion[]>;
	createCatalogKeyword(input: { label: string; aliases: string[] }): Promise<{
		status: number;
		error?: string;
		keyword?: CatalogKeyword;
	}>;
	/** Ficha pública de quien publica (#458); null si no existe. */
	getPublicAuthor(
		id: string,
		opts?: { limit?: number; offset?: number },
	): Promise<(PaginatedResult<Resource> & { author: PublicAuthor }) | null>;
	getPublicTagBySlug(slug: string): Promise<TagRecord | null>;
	listPublicTagResources(
		slug: string,
		opts?: { limit?: number; offset?: number },
	): Promise<PaginatedResult<Resource> & { tag: TagRecord }>;
	listPublicCollections(opts?: {
		q?: string;
		limit?: number;
		offset?: number;
	}): Promise<PaginatedResult<CollectionRecord>>;
	getPublicCollectionBySlug(
		slug: string,
	): Promise<CollectionDetailRecord | null>;
	getConfig(): Promise<AppConfig>;
	getPlatformStats(): Promise<{ users: number }>;

	// Auth
	getSession(): Promise<SessionData | null>;
	signUp(
		name: string,
		email: string,
		password: string,
		callbackURL?: string,
	): Promise<SignInResult>;
	signIn(email: string, password: string): Promise<SignInResult>;
	/** #531: siempre ok salvo fallo de red, para no revelar qué correos hay. */
	requestPasswordReset(email: string): Promise<SignInResult>;
	resetPassword(token: string, newPassword: string): Promise<SignInResult>;
	signInOidc(): Promise<SignInResult>;
	signOut(): Promise<void>;

	// Admin
	listAdminResources(opts?: {
		q?: string;
		limit?: number;
		offset?: number;
		status?: string;
	}): Promise<ResourceListResult>;
	getResourceById(id: string): Promise<Resource | null>;
	listResourceMediaItems(id: string): Promise<MediaItemRecord[]>;
	listResourceUploads(id: string): Promise<UploadSessionRecord[]>;
	createDraftResource(): Promise<{ id: string; slug: string }>;
	createResource(
		data: CreateResourceInput,
	): Promise<{ id: string; slug: string }>;
	updateResource(
		id: string,
		data: UpdateResourceInput,
	): Promise<{
		ok: boolean;
		error?: string;
		details?: { field: string; message: string }[];
	}>;
	updateResourceStatus(
		id: string,
		status: string,
	): Promise<{ id: string; status: string }>;
	deleteResource(id: string): Promise<void>;
	getUploadConfig(): Promise<UploadConfig>;
	cancelUpload(id: string): Promise<{ id: string; cancelled: boolean }>;
	deleteMediaItem(
		resourceId: string,
		mediaItemId: string,
	): Promise<{ id: string; deleted: boolean }>;
	getElpxProject(resourceId: string): Promise<ElpxProjectInfo | null>;
	generateElpx(resourceId: string): Promise<{
		ok: boolean;
		elpxHash: string;
		hasPreview: boolean;
		previewUrl: string | null;
		elpxFileUrl: string | null;
	}>;

	listUsers(opts?: {
		q?: string;
		role?: string;
		limit?: number;
		offset?: number;
	}): Promise<PaginatedResult<UserRecord>>;
	getUserById(id: string): Promise<UserRecord | null>;
	createUser(data: {
		name?: string;
		email: string;
		password: string;
		role?: string;
	}): Promise<{
		ok: boolean;
		id?: string;
		error?: string;
		details?: { field: string; message: string }[];
	}>;
	updateUser(
		id: string,
		data: Partial<Pick<UserRecord, "name" | "bio" | "role" | "isActive">>,
	): Promise<{ ok: boolean; error?: string }>;
	deleteUser(id: string): Promise<{ ok: boolean; error?: string }>;

	listCollections(opts?: {
		q?: string;
		limit?: number;
		offset?: number;
	}): Promise<PaginatedResult<CollectionRecord>>;
	getCollectionById(id: string): Promise<CollectionRecord | null>;
	listCollectionResources(
		collectionId: string,
	): Promise<CollectionResourceRecord[]>;
	createCollection(data: {
		title: string;
		description: string;
		coverImageUrl?: string | null;
		editorialStatus?: string;
		isOrdered?: boolean;
	}): Promise<{ id: string; slug: string }>;
	updateCollection(
		id: string,
		data: Partial<{
			title: string;
			description: string;
			coverImageUrl: string | null;
			editorialStatus: string;
			isOrdered: boolean;
		}>,
	): Promise<{
		ok: boolean;
		error?: string;
		details?: { field: string; message: string }[];
	}>;
	deleteCollection(id: string): Promise<void>;
	addResourceToCollection(
		collectionId: string,
		resourceId: string,
	): Promise<{ ok: boolean }>;
	removeResourceFromCollection(
		collectionId: string,
		resourceId: string,
	): Promise<{ ok: boolean }>;
	reorderCollectionResource(
		collectionId: string,
		resourceId: string,
		direction: "up" | "down",
	): Promise<{ ok: boolean; error?: string }>;

	listTaxonomies(opts?: {
		q?: string;
		type?: string;
		limit?: number;
		offset?: number;
	}): Promise<PaginatedResult<TaxonomyRecord>>;
	getTaxonomyById(id: string): Promise<TaxonomyRecord | null>;
	createTaxonomy(data: {
		name: string;
		slug?: string;
		type?: string;
		parentId?: string | null;
	}): Promise<{ id: string; slug: string }>;
	updateTaxonomy(
		id: string,
		data: Partial<{
			name: string;
			slug: string;
			type: string;
			parentId: string | null;
		}>,
	): Promise<{
		ok: boolean;
		error?: string;
		details?: { field: string; message: string }[];
	}>;
	deleteTaxonomy(id: string): Promise<void>;

	// Áreas de conocimiento (#448). Lanzan `{ error }` si el servidor rechaza.
	listAdminKnowledgeAreas(): Promise<KnowledgeAreaCatalog>;
	createAdminKnowledgeArea(
		input: KnowledgeAreaInput & { label: string; blockId: string },
	): Promise<KnowledgeAreaRecord>;
	updateAdminKnowledgeArea(
		id: string,
		input: KnowledgeAreaInput,
	): Promise<KnowledgeAreaRecord>;

	// Tags admin (#76 / #310)
	listAdminTags(opts?: {
		q?: string;
		limit?: number;
		offset?: number;
	}): Promise<PaginatedResult<TagRecord>>;
	updateAdminTag(
		id: string,
		data: { label?: string; description?: string | null },
	): Promise<TagRecord>;
	deleteAdminTag(id: string, reassignTo?: string): Promise<void>;
	mergeAdminTags(
		sourceId: string,
		targetId: string,
	): Promise<{ target: TagRecord; reassigned: number }>;
	migrateKeywordsToTags(): Promise<{
		resourcesProcessed: number;
		tagsCreated: number;
		linksCreated: number;
	}>;
	listSimilarAdminTags(id: string): Promise<TagRecord[]>;

	// Social
	getResourceRatings(slug: string): Promise<{
		resourceId: string;
		averageScore: number;
		totalRatings: number;
		distribution: Record<number, number>;
	}>;
	submitRating(
		slug: string,
		score: number,
	): Promise<{
		resourceId: string;
		userId: string;
		score: number;
		createdAt: string;
	}>;
	toggleFavorite(slug: string): Promise<{ favorited: boolean; count: number }>;
	getUserFavorites(opts?: {
		limit?: number;
		offset?: number;
	}): Promise<PaginatedResult<Resource>>;
	getUserRatings(opts?: {
		limit?: number;
		offset?: number;
	}): Promise<PaginatedResult<Resource>>;
	getUserDashboard(): Promise<{
		draftCount: number;
		publishedCount: number;
		favoriteCount: number;
		ratingCount?: number;
		recentResources: Resource[];
	}>;
	getMyProfile(): Promise<UserRecord | null>;
	updateMyProfile(
		data: Partial<Pick<UserRecord, "name" | "bio">>,
	): Promise<{ ok: boolean; error?: string }>;
	getUserActivity(opts?: {
		limit?: number;
		offset?: number;
	}): Promise<PaginatedResult<import("./types/user-extended.ts").ActivityItem>>;
	trackDownload(slug: string, format?: string): Promise<{ count: number }>;
	/** Una visita por sesión al abrir la vista previa (ADR-0044). */
	trackResourceView(
		slug: string,
		sessionId: string,
	): Promise<{ viewCount: number }>;
	getResourceStats(slug: string): Promise<{
		downloadCount: number;
		exportCounts: { scorm: number; ims: number; web: number; epub: number };
		favoriteCount: number;
		ratingAvg: number;
		ratingCount: number;
		userFavorited: boolean;
		viewCount?: number;
	}>;
	reportResource(
		slug: string,
		reason: string,
		description?: string,
	): Promise<{ id: string }>;

	// Admin Reports
	listReports(opts?: {
		status?: string;
		reason?: string;
		resourceId?: string;
		limit?: number;
		offset?: number;
	}): Promise<PaginatedResult<ReportRecord>>;
	getReportById(id: string): Promise<ReportRecord | null>;
	updateReport(
		id: string,
		data: { status?: string; resolution?: string; actionTaken?: string },
	): Promise<ReportRecord>;

	// Badges / Settings
	getBadgeConfig(): Promise<BadgeConfig>;
	getSettings(): Promise<Record<string, string>>;
	updateSettings(
		settings: Record<string, string>,
	): Promise<Record<string, string>>;

	// API Tokens (User)
	listApiTokens(): Promise<ApiTokenRecord[]>;
	createApiToken(name: string, expiresAt?: string): Promise<ApiTokenRecord>;
	revokeApiToken(id: string): Promise<void>;

	// API Tokens (Admin)
	listAllApiTokens(filters?: {
		userId?: string;
		status?: "active" | "revoked" | "expired";
	}): Promise<ApiTokenRecord[]>;
	revokeApiTokenAdmin(id: string): Promise<void>;
	getGlobalApiTokenStats(): Promise<ApiTokenStats>;

	// Dev
	seedResources(
		count: number,
		clean?: boolean,
	): Promise<{ count: number; durationMs: number }>;
}
