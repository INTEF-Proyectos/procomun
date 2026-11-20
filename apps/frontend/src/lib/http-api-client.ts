import type {
	ApiClient,
	ApiTokenRecord,
	ApiTokenStats,
	AppConfig,
	CatalogKeyword,
	CollectionDetailRecord,
	CollectionRecord,
	CollectionResourceRecord,
	CreateResourceInput,
	KeywordSuggestion,
	KnowledgeAreaCatalog,
	KnowledgeAreaInput,
	KnowledgeAreaRecord,
	MediaItemRecord,
	MyResourcesOptions,
	MyResourcesResult,
	PaginatedResult,
	PublicAuthor,
	PublicKnowledgeAreaCatalog,
	RelatedResourcesResult,
	ReportRecord,
	Resource,
	ResourceListResult,
	SessionData,
	SignInResult,
	TagRecord,
	TaxonomyRecord,
	UpdateResourceInput,
	UploadConfig,
	UploadSessionRecord,
	UserRecord,
} from "./api-client.ts";
import { url } from "./paths.ts";

/** Parámetros de filtrado comunes al buscador y a «Mis recursos» (#530). */
function resourceFilterParams(opts?: {
	status?: string;
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
}): URLSearchParams {
	const params = new URLSearchParams();
	if (opts?.status) params.set("status", opts.status);
	if (opts?.q) params.set("q", opts.q);
	if (opts?.limit) params.set("limit", String(opts.limit));
	if (opts?.offset) params.set("offset", String(opts.offset));
	if (opts?.resourceType) params.set("resourceType", opts.resourceType);
	if (opts?.language) params.set("language", opts.language);
	if (opts?.license) params.set("license", opts.license);
	if (opts?.tag) params.set("tag", opts.tag);
	if (opts?.educationalCategory) {
		params.set("educationalCategory", opts.educationalCategory);
	}
	if (opts?.educationalOption) {
		params.set("educationalOption", opts.educationalOption);
	}
	if (opts?.knowledgeAreas?.length) {
		params.set("knowledgeAreas", opts.knowledgeAreas.join(","));
	}
	if (opts?.professionalFamilies?.length) {
		params.set("professionalFamilies", opts.professionalFamilies.join(","));
	}
	return params;
}

/**
 * Cliente HTTP que llama al servidor API real.
 * Usado en modo normal (desarrollo y producción).
 */
export class HttpApiClient implements ApiClient {
	async listResources(opts?: {
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
	}): Promise<ResourceListResult> {
		const qs = resourceFilterParams(opts).toString();
		const res = await fetch(`/api/v1/resources${qs ? `?${qs}` : ""}`);
		return res.json();
	}

	async getKnowledgeAreaCatalog(): Promise<PublicKnowledgeAreaCatalog> {
		const res = await fetch("/api/v1/knowledge-areas");
		if (!res.ok) throw await res.json().catch(() => ({}));
		return res.json();
	}

	async listPublicTags(opts?: {
		q?: string;
		limit?: number;
		offset?: number;
	}): Promise<PaginatedResult<TagRecord>> {
		const params = new URLSearchParams();
		if (opts?.q) params.set("q", opts.q);
		if (opts?.limit) params.set("limit", String(opts.limit));
		if (opts?.offset) params.set("offset", String(opts.offset));
		const qs = params.toString();
		const res = await fetch(`/api/v1/tags${qs ? `?${qs}` : ""}`);
		return res.json();
	}

	async listPopularTags(limit = 20): Promise<TagRecord[]> {
		const res = await fetch(`/api/v1/tags/popular?limit=${limit}`);
		const body = await res.json();
		return Array.isArray(body.data) ? body.data : [];
	}

	async searchKeywords(
		query: string,
		includeTags = false,
	): Promise<KeywordSuggestion[]> {
		const params = new URLSearchParams({ q: query });
		if (includeTags) params.set("tags", "1");
		const res = await fetch(`/api/v1/keywords?${params}`);
		if (!res.ok) return [];
		const body = await res.json();
		return Array.isArray(body.data) ? body.data : [];
	}

	async createCatalogKeyword(input: { label: string; aliases: string[] }) {
		const res = await fetch("/api/admin/keywords", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({ ...input, confirm: true }),
		});
		const body = await res.json().catch(() => ({}));
		return res.status === 201
			? { status: 201, keyword: body as CatalogKeyword }
			: { status: res.status, error: body.error, keyword: body.keyword };
	}

	async getPublicAuthor(
		id: string,
		opts?: { limit?: number; offset?: number },
	): Promise<(PaginatedResult<Resource> & { author: PublicAuthor }) | null> {
		const params = new URLSearchParams();
		if (opts?.limit) params.set("limit", String(opts.limit));
		if (opts?.offset) params.set("offset", String(opts.offset));
		const qs = params.toString();
		const res = await fetch(
			`/api/v1/authors/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`,
		);
		if (res.status === 404) return null;
		if (!res.ok) throw await res.json().catch(() => ({}));
		return res.json();
	}

	async getPublicTagBySlug(slug: string): Promise<TagRecord | null> {
		const res = await fetch(`/api/v1/tags/${encodeURIComponent(slug)}`);
		if (!res.ok) return null;
		return res.json();
	}

	async listPublicTagResources(
		slug: string,
		opts?: { limit?: number; offset?: number },
	): Promise<PaginatedResult<Resource> & { tag: TagRecord }> {
		const params = new URLSearchParams();
		if (opts?.limit) params.set("limit", String(opts.limit));
		if (opts?.offset) params.set("offset", String(opts.offset));
		const qs = params.toString();
		const res = await fetch(
			`/api/v1/tags/${encodeURIComponent(slug)}/resources${qs ? `?${qs}` : ""}`,
		);
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw err;
		}
		return res.json();
	}

	async getResourceBySlug(slug: string): Promise<Resource | null> {
		const res = await fetch(`/api/v1/resources/${slug}`);
		if (!res.ok) return null;
		return res.json();
	}

	async getRelatedResources(
		slug: string,
		opts?: { limit?: number },
	): Promise<RelatedResourcesResult> {
		const params = new URLSearchParams();
		if (opts?.limit != null) params.set("limit", String(opts.limit));
		const qs = params.toString();
		const res = await fetch(
			`/api/v1/resources/${encodeURIComponent(slug)}/related${qs ? `?${qs}` : ""}`,
		);
		if (!res.ok) {
			return { data: [], sameAuthor: [], limit: opts?.limit ?? 6 };
		}
		return res.json();
	}

	async listPublicCollections(opts?: {
		q?: string;
		limit?: number;
		offset?: number;
	}): Promise<PaginatedResult<CollectionRecord>> {
		const params = new URLSearchParams();
		if (opts?.q) params.set("q", opts.q);
		if (opts?.limit) params.set("limit", String(opts.limit));
		if (opts?.offset) params.set("offset", String(opts.offset));
		const qs = params.toString();
		const res = await fetch(`/api/v1/collections${qs ? `?${qs}` : ""}`);
		return res.json();
	}

	async getPublicCollectionBySlug(
		slug: string,
	): Promise<CollectionDetailRecord | null> {
		const res = await fetch(`/api/v1/collections/${slug}`);
		if (!res.ok) return null;
		return res.json();
	}

	async getConfig(): Promise<AppConfig> {
		const res = await fetch("/api/v1/config");
		return res.json();
	}

	async getPlatformStats(): Promise<{ users: number }> {
		const res = await fetch("/api/v1/stats");
		return res.json();
	}

	async getSession(): Promise<SessionData | null> {
		try {
			const res = await fetch("/api/auth/get-session", {
				credentials: "include",
			});
			if (!res.ok) return null;
			const data = await res.json();
			if (!data?.user) return null;
			return data;
		} catch {
			return null;
		}
	}

	async signUp(
		name: string,
		email: string,
		password: string,
		callbackURL?: string,
	): Promise<SignInResult> {
		const res = await fetch("/api/auth/sign-up/email", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({ name, email, password, callbackURL }),
		});
		if (res.ok) return { ok: true };
		const data = await res.json().catch(() => null);
		return { ok: false, error: data?.message ?? "Error al crear la cuenta" };
	}

	async signIn(email: string, password: string): Promise<SignInResult> {
		const res = await fetch("/api/auth/sign-in/email", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({ email, password }),
		});
		if (res.ok) return { ok: true };
		const data = await res.json().catch(() => null);
		const error = data?.message ?? "Credenciales incorrectas";
		return typeof data?.code === "string"
			? { ok: false, code: data.code, error }
			: { ok: false, error };
	}

	/**
	 * Pide el correo de recuperación (#531). better-auth responde lo mismo
	 * exista o no la cuenta y no espera al envío (#551), así que un error aquí
	 * no delata nada: es la recuperación apagada (sin SMTP) o el límite de
	 * peticiones, y la interfaz no debe decir «enviado». Sin `error`: el
	 * mensaje lo pone la isla, traducido.
	 */
	async requestPasswordReset(email: string): Promise<SignInResult> {
		try {
			const res = await fetch("/api/auth/request-password-reset", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				// url(): respeta la ruta base y el prefijo de idioma (#551).
				body: JSON.stringify({ email, redirectTo: url("restablecer") }),
			});
			return res.ok ? { ok: true } : { ok: false };
		} catch {
			return { ok: false };
		}
	}

	/** Fija la contraseña nueva con el token del enlace (#531). */
	async resetPassword(
		token: string,
		newPassword: string,
	): Promise<SignInResult> {
		let res: Response;
		try {
			res = await fetch("/api/auth/reset-password", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ token, newPassword }),
			});
		} catch {
			// Fallo de red (#551): la isla enseña el error de conexión.
			return { ok: false };
		}
		if (res.ok) return { ok: true };
		const data = await res.json().catch(() => null);
		return {
			ok: false,
			error:
				data?.message ??
				"El enlace no vale: puede haber caducado o haberse usado ya.",
		};
	}

	/**
	 * Cambia la contraseña (#532). Cierra las demás sesiones: quien la cambia
	 * porque sospecha que se la han robado necesita que la otra deje de valer.
	 * Con la contraseña actual equivocada devuelve el código
	 * `wrong_current_password`, que la isla traduce.
	 */
	async changePassword(
		currentPassword: string,
		newPassword: string,
	): Promise<SignInResult> {
		let res: Response;
		try {
			res = await fetch("/api/auth/change-password", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					currentPassword,
					newPassword,
					revokeOtherSessions: true,
				}),
			});
		} catch {
			// Fallo de red (#552): la isla enseña el error de conexión.
			return { ok: false };
		}
		if (res.ok) return { ok: true };
		const data = await res.json().catch(() => null);
		if (data?.code === "INVALID_PASSWORD") {
			return { ok: false, error: "wrong_current_password" };
		}
		return { ok: false, error: data?.message ?? "No se ha podido cambiar" };
	}

	/**
	 * Pide el cambio de correo (#532). No cambia nada al momento: con el correo
	 * verificado, Better Auth avisa antes a la dirección antigua; en todo caso
	 * hay que verificar la nueva.
	 */
	async changeEmail(newEmail: string): Promise<SignInResult> {
		let res: Response;
		try {
			res = await fetch("/api/auth/change-email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				// url(): respeta la ruta base y el prefijo de idioma (#552).
				body: JSON.stringify({
					newEmail,
					callbackURL: url("perfil?tab=account"),
				}),
			});
		} catch {
			return { ok: false };
		}
		if (res.ok) return { ok: true };
		const data = await res.json().catch(() => null);
		return { ok: false, error: data?.message ?? "No se ha podido cambiar" };
	}

	/**
	 * ¿La cuenta tiene contraseña propia? Las de acceso institucional (OIDC)
	 * no: su contraseña y su correo se gestionan en el proveedor de identidad.
	 * Si no se puede saber, `false`: ofrecer cambiar una contraseña que no
	 * existe acaba en error.
	 */
	async hasPasswordAccount(): Promise<boolean> {
		try {
			const res = await fetch("/api/auth/list-accounts", {
				credentials: "include",
			});
			if (!res.ok) return false;
			const accounts = (await res.json()) as Array<{ providerId?: string }>;
			return accounts.some((a) => a.providerId === "credential");
		} catch {
			return false;
		}
	}

	async signInOidc(): Promise<SignInResult> {
		// Desde Better Auth 1.7 el proveedor genérico usa el flujo social: no
		// existe /sign-in/oauth2 y la vuelta llega a /api/auth/callback/oidc
		// (#527, ADR-0007).
		const res = await fetch("/api/auth/sign-in/social", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({ provider: "oidc", callbackURL: "/admin" }),
			redirect: "manual",
		});
		const location = res.headers.get("location");
		if (location) return { ok: true, redirectUrl: location };
		if (res.ok) {
			const data = await res.json().catch(() => null);
			if (data?.url) return { ok: true, redirectUrl: data.url };
		}
		return { ok: false, error: "No se pudo iniciar el login institucional" };
	}

	async signOut(): Promise<void> {
		await fetch("/api/auth/sign-out", {
			method: "POST",
			credentials: "include",
		});
	}

	async listAdminResources(opts?: {
		q?: string;
		limit?: number;
		offset?: number;
		status?: string;
	}): Promise<ResourceListResult> {
		const params = new URLSearchParams();
		if (opts?.q) params.set("q", opts.q);
		if (opts?.limit != null) params.set("limit", String(opts.limit));
		if (opts?.offset != null) params.set("offset", String(opts.offset));
		if (opts?.status) params.set("status", opts.status);
		const qs = params.toString();
		const res = await fetch(`/api/admin/resources${qs ? `?${qs}` : ""}`, {
			credentials: "include",
		});
		if (!res.ok) throw new Error(`listAdminResources failed: ${res.status}`);
		return res.json();
	}

	async getResourceById(id: string): Promise<Resource | null> {
		const res = await fetch(`/api/admin/resources/${id}`, {
			credentials: "include",
		});
		if (!res.ok) return null;
		return res.json();
	}

	async listResourceMediaItems(id: string): Promise<MediaItemRecord[]> {
		const res = await fetch(`/api/admin/resources/${id}/media`, {
			credentials: "include",
		});
		if (!res.ok) return [];
		return res.json();
	}

	async listResourceUploads(id: string): Promise<UploadSessionRecord[]> {
		const res = await fetch(`/api/admin/resources/${id}/uploads`, {
			credentials: "include",
		});
		if (!res.ok) return [];
		return res.json();
	}

	async createDraftResource(): Promise<{ id: string; slug: string }> {
		const res = await fetch("/api/admin/resources/draft", {
			method: "POST",
			credentials: "include",
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw new Error(
				(err as Record<string, string>).error ?? "Error al crear el borrador",
			);
		}
		return res.json();
	}

	async createResource(
		data: CreateResourceInput,
	): Promise<{ id: string; slug: string }> {
		const res = await fetch("/api/admin/resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify(data),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw err;
		}
		return res.json();
	}

	async updateResource(id: string, data: UpdateResourceInput) {
		const res = await fetch(`/api/admin/resources/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify(data),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			return { ok: false, error: err.error, details: err.details };
		}
		return { ok: true };
	}

	async updateResourceStatus(
		id: string,
		status: string,
	): Promise<{ id: string; status: string }> {
		const res = await fetch(`/api/admin/resources/${id}/status`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({ status }),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw err;
		}
		return res.json();
	}

	async deleteResource(id: string): Promise<void> {
		const res = await fetch(`/api/admin/resources/${id}`, {
			method: "DELETE",
			credentials: "include",
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw new Error(err.error || "Error al eliminar el recurso");
		}
	}

	async getUploadConfig(): Promise<UploadConfig> {
		const res = await fetch("/api/admin/uploads/config", {
			credentials: "include",
		});
		return res.json();
	}

	async cancelUpload(id: string): Promise<{ id: string; cancelled: boolean }> {
		const res = await fetch(`/api/admin/uploads/${id}`, {
			method: "DELETE",
			credentials: "include",
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw err;
		}
		return res.json();
	}

	async deleteMediaItem(
		resourceId: string,
		mediaItemId: string,
	): Promise<{ id: string; deleted: boolean }> {
		const res = await fetch(
			`/api/admin/resources/${resourceId}/media/${mediaItemId}`,
			{
				method: "DELETE",
				credentials: "include",
			},
		);
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw new Error(
				(err as Record<string, string>).error ?? "Error al eliminar el archivo",
			);
		}
		return res.json();
	}

	async getElpxProject(
		resourceId: string,
	): Promise<import("./api-client.ts").ElpxProjectInfo | null> {
		const res = await fetch(`/api/admin/resources/${resourceId}/elpx`, {
			credentials: "include",
		});
		if (!res.ok) return null;
		return res.json();
	}

	async generateElpx(resourceId: string) {
		const res = await fetch(`/api/admin/elpx/generate/${resourceId}`, {
			method: "POST",
			credentials: "include",
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw new Error(
				(err as Record<string, string>).error ?? "Error al generar el .elpx",
			);
		}
		return res.json();
	}

	async listUsers(opts?: {
		q?: string;
		role?: string;
		limit?: number;
		offset?: number;
	}): Promise<PaginatedResult<UserRecord>> {
		const params = new URLSearchParams();
		if (opts?.q) params.set("q", opts.q);
		if (opts?.role) params.set("role", opts.role);
		if (opts?.limit) params.set("limit", String(opts.limit));
		if (opts?.offset) params.set("offset", String(opts.offset));
		const qs = params.toString();
		const res = await fetch(`/api/admin/users${qs ? `?${qs}` : ""}`, {
			credentials: "include",
		});
		return res.json();
	}

	async getUserById(id: string): Promise<UserRecord | null> {
		const res = await fetch(`/api/admin/users/${id}`, {
			credentials: "include",
		});
		if (!res.ok) return null;
		return res.json();
	}

	async createUser(data: {
		name?: string;
		email: string;
		password: string;
		role?: string;
	}) {
		const res = await fetch("/api/admin/users", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify(data),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			return {
				ok: false as const,
				error: err.error ?? "Error al crear usuario",
				details: err.details,
			};
		}
		const body = await res.json();
		return { ok: true as const, id: body.id };
	}

	async updateUser(
		id: string,
		data: Partial<Pick<UserRecord, "name" | "bio" | "role" | "isActive">>,
	) {
		const res = await fetch(`/api/admin/users/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify(data),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			return { ok: false, error: err.error ?? "Error al actualizar usuario" };
		}
		return { ok: true };
	}

	async deleteUser(id: string) {
		const res = await fetch(`/api/admin/users/${id}`, {
			method: "DELETE",
			credentials: "include",
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			return {
				ok: false as const,
				error: err.error ?? "Error al eliminar usuario",
			};
		}
		return { ok: true as const };
	}

	async listCollections(opts?: {
		q?: string;
		limit?: number;
		offset?: number;
	}): Promise<PaginatedResult<CollectionRecord>> {
		const params = new URLSearchParams();
		if (opts?.q) params.set("q", opts.q);
		if (opts?.limit) params.set("limit", String(opts.limit));
		if (opts?.offset) params.set("offset", String(opts.offset));
		const qs = params.toString();
		const res = await fetch(`/api/admin/collections${qs ? `?${qs}` : ""}`, {
			credentials: "include",
		});
		return res.json();
	}

	async getCollectionById(id: string): Promise<CollectionRecord | null> {
		const res = await fetch(`/api/admin/collections/${id}`, {
			credentials: "include",
		});
		if (!res.ok) return null;
		return res.json();
	}

	async listCollectionResources(
		collectionId: string,
	): Promise<CollectionResourceRecord[]> {
		const res = await fetch(
			`/api/admin/collections/${collectionId}/resources`,
			{ credentials: "include" },
		);
		if (!res.ok) return [];
		return res.json();
	}

	async createCollection(data: {
		title: string;
		description: string;
		coverImageUrl?: string | null;
		editorialStatus?: string;
		isOrdered?: boolean;
	}) {
		const res = await fetch("/api/admin/collections", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify(data),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw err;
		}
		return res.json();
	}

	async updateCollection(
		id: string,
		data: Partial<{
			title: string;
			description: string;
			coverImageUrl: string | null;
			editorialStatus: string;
			isOrdered: boolean;
		}>,
	) {
		const res = await fetch(`/api/admin/collections/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify(data),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			return { ok: false, error: err.error, details: err.details };
		}
		return { ok: true };
	}

	async deleteCollection(id: string): Promise<void> {
		await fetch(`/api/admin/collections/${id}`, {
			method: "DELETE",
			credentials: "include",
		});
	}

	async addResourceToCollection(
		collectionId: string,
		resourceId: string,
	): Promise<{ ok: boolean }> {
		const res = await fetch(
			`/api/admin/collections/${collectionId}/resources`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ resourceId }),
			},
		);
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw err;
		}
		return res.json();
	}

	async removeResourceFromCollection(
		collectionId: string,
		resourceId: string,
	): Promise<{ ok: boolean }> {
		const res = await fetch(
			`/api/admin/collections/${collectionId}/resources/${resourceId}`,
			{
				method: "DELETE",
				credentials: "include",
			},
		);
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw err;
		}
		return res.json();
	}

	async reorderCollectionResource(
		collectionId: string,
		resourceId: string,
		direction: "up" | "down",
	): Promise<{ ok: boolean; error?: string }> {
		const res = await fetch(
			`/api/admin/collections/${collectionId}/resources/reorder`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ resourceId, direction }),
			},
		);
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			return {
				ok: false,
				error: err.error ?? "No se pudo reordenar el recurso",
			};
		}
		return res.json();
	}

	async listTaxonomies(opts?: {
		q?: string;
		type?: string;
		limit?: number;
		offset?: number;
	}): Promise<PaginatedResult<TaxonomyRecord>> {
		const params = new URLSearchParams();
		if (opts?.q) params.set("q", opts.q);
		if (opts?.type) params.set("type", opts.type);
		if (opts?.limit) params.set("limit", String(opts.limit));
		if (opts?.offset) params.set("offset", String(opts.offset));
		const qs = params.toString();
		const res = await fetch(`/api/admin/taxonomies${qs ? `?${qs}` : ""}`, {
			credentials: "include",
		});
		return res.json();
	}

	async getTaxonomyById(id: string): Promise<TaxonomyRecord | null> {
		const res = await fetch(`/api/admin/taxonomies/${id}`, {
			credentials: "include",
		});
		if (!res.ok) return null;
		return res.json();
	}

	async createTaxonomy(data: {
		name: string;
		slug?: string;
		type?: string;
		parentId?: string | null;
	}) {
		const res = await fetch("/api/admin/taxonomies", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify(data),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw err;
		}
		return res.json();
	}

	async updateTaxonomy(
		id: string,
		data: Partial<{
			name: string;
			slug: string;
			type: string;
			parentId: string | null;
		}>,
	) {
		const res = await fetch(`/api/admin/taxonomies/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify(data),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			return { ok: false, error: err.error, details: err.details };
		}
		return { ok: true };
	}

	async deleteTaxonomy(id: string): Promise<void> {
		await fetch(`/api/admin/taxonomies/${id}`, {
			method: "DELETE",
			credentials: "include",
		});
	}

	async listAdminTags(opts?: {
		q?: string;
		limit?: number;
		offset?: number;
	}): Promise<PaginatedResult<TagRecord>> {
		const params = new URLSearchParams();
		if (opts?.q) params.set("q", opts.q);
		if (opts?.limit) params.set("limit", String(opts.limit));
		if (opts?.offset) params.set("offset", String(opts.offset));
		const qs = params.toString();
		const res = await fetch(`/api/admin/tags${qs ? `?${qs}` : ""}`, {
			credentials: "include",
		});
		return res.json();
	}

	async listAdminKnowledgeAreas(): Promise<KnowledgeAreaCatalog> {
		const res = await fetch("/api/admin/knowledge-areas", {
			credentials: "include",
		});
		if (!res.ok) throw await res.json().catch(() => ({}));
		return res.json();
	}

	async createAdminKnowledgeArea(
		input: KnowledgeAreaInput & { label: string; blockId: string },
	): Promise<KnowledgeAreaRecord> {
		const res = await fetch("/api/admin/knowledge-areas", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify(input),
		});
		if (!res.ok) throw await res.json().catch(() => ({}));
		return res.json();
	}

	async updateAdminKnowledgeArea(
		id: string,
		input: KnowledgeAreaInput,
	): Promise<KnowledgeAreaRecord> {
		const res = await fetch(
			`/api/admin/knowledge-areas/${encodeURIComponent(id)}`,
			{
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify(input),
			},
		);
		if (!res.ok) throw await res.json().catch(() => ({}));
		return res.json();
	}

	async updateAdminTag(
		id: string,
		data: { label?: string; description?: string | null },
	): Promise<TagRecord> {
		const res = await fetch(`/api/admin/tags/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify(data),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw err;
		}
		return res.json();
	}

	async deleteAdminTag(id: string, reassignTo?: string): Promise<void> {
		const qs = reassignTo
			? `?reassignTo=${encodeURIComponent(reassignTo)}`
			: "";
		const res = await fetch(`/api/admin/tags/${id}${qs}`, {
			method: "DELETE",
			credentials: "include",
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw err;
		}
	}

	async mergeAdminTags(
		sourceId: string,
		targetId: string,
	): Promise<{ target: TagRecord; reassigned: number }> {
		const res = await fetch("/api/admin/tags/merge", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({ sourceId, targetId }),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw err;
		}
		return res.json();
	}

	async migrateKeywordsToTags(): Promise<{
		resourcesProcessed: number;
		tagsCreated: number;
		linksCreated: number;
	}> {
		const res = await fetch("/api/admin/tags/migrate-keywords", {
			method: "POST",
			credentials: "include",
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw err;
		}
		return res.json();
	}

	async listSimilarAdminTags(id: string): Promise<TagRecord[]> {
		const res = await fetch(`/api/admin/tags/${id}/similar`, {
			credentials: "include",
		});
		if (!res.ok) return [];
		const body = await res.json();
		return Array.isArray(body.data) ? body.data : [];
	}

	// --- Social ---

	async getResourceRatings(slug: string) {
		const res = await fetch(`/api/v1/resources/${slug}/ratings`);
		return res.json();
	}

	async submitRating(slug: string, score: number) {
		const res = await fetch(`/api/v1/resources/${slug}/ratings`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({ score }),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw err;
		}
		return res.json();
	}

	async toggleFavorite(slug: string) {
		const res = await fetch(`/api/v1/resources/${slug}/favorite`, {
			method: "POST",
			credentials: "include",
		});
		return res.json();
	}

	async getUserFavorites(opts?: {
		limit?: number;
		offset?: number;
	}): Promise<
		import("./api-client.ts").PaginatedResult<
			import("./api-client.ts").Resource
		>
	> {
		const params = new URLSearchParams();
		if (opts?.limit) params.set("limit", String(opts.limit));
		if (opts?.offset) params.set("offset", String(opts.offset));
		const qs = params.toString();
		const res = await fetch(`/api/v1/users/me/favorites${qs ? `?${qs}` : ""}`, {
			credentials: "include",
		});
		return res.json();
	}

	async getUserRatings(opts?: {
		limit?: number;
		offset?: number;
	}): Promise<
		import("./api-client.ts").PaginatedResult<
			import("./api-client.ts").Resource
		>
	> {
		const params = new URLSearchParams();
		if (opts?.limit) params.set("limit", String(opts.limit));
		if (opts?.offset) params.set("offset", String(opts.offset));
		const qs = params.toString();
		const res = await fetch(`/api/v1/users/me/ratings${qs ? `?${qs}` : ""}`, {
			credentials: "include",
		});
		return res.json();
	}

	async listMyResources(opts?: MyResourcesOptions): Promise<MyResourcesResult> {
		const qs = resourceFilterParams(opts).toString();
		const res = await fetch(`/api/v1/users/me/resources${qs ? `?${qs}` : ""}`, {
			credentials: "include",
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw new Error(err.error || "Error al cargar tus recursos");
		}
		return res.json();
	}

	async getUserDashboard() {
		const res = await fetch("/api/v1/users/me/dashboard", {
			credentials: "include",
		});
		return res.json();
	}

	async getMyProfile(): Promise<import("./api-client.ts").MyProfile | null> {
		const res = await fetch("/api/v1/users/me/profile", {
			credentials: "include",
		});
		if (!res.ok) return null;
		return res.json();
	}

	async updateMyProfile(data: import("./api-client.ts").MyProfileUpdate) {
		const res = await fetch("/api/v1/users/me/profile", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify(data),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			const error: string = err.error ?? "Error al actualizar perfil";
			// #533: errores por campo para señalarlos en el formulario.
			if (!Array.isArray(err.details)) return { ok: false, error };
			const fieldErrors = (
				err.details as Array<{ field?: unknown; code?: unknown }>
			)
				.filter(
					(detail) =>
						typeof detail?.field === "string" &&
						typeof detail?.code === "string",
				)
				.map((detail) => ({
					field: detail.field as string,
					code: detail.code as string,
				}));
			return { ok: false, error, fieldErrors };
		}
		return { ok: true };
	}

	async getUserActivity(opts?: {
		limit?: number;
		offset?: number;
	}): Promise<
		import("./api-client.ts").PaginatedResult<
			import("./types/user-extended.ts").ActivityItem
		>
	> {
		const params = new URLSearchParams();
		if (opts?.limit) params.set("limit", String(opts.limit));
		if (opts?.offset) params.set("offset", String(opts.offset));
		const qs = params.toString();
		const res = await fetch(`/api/v1/users/me/activity${qs ? `?${qs}` : ""}`, {
			credentials: "include",
		});
		return res.json();
	}

	async trackDownload(
		slug: string,
		format?: string,
	): Promise<{ count: number }> {
		const res = await fetch(`/api/v1/resources/${slug}/download`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ format: format ?? "direct" }),
			credentials: "include",
		});
		return res.json();
	}

	async trackResourceView(
		slug: string,
		sessionId: string,
	): Promise<{ viewCount: number }> {
		const res = await fetch(`/api/v1/resources/${slug}/view`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ sessionId }),
		});
		if (!res.ok)
			throw new Error(`No se pudo registrar la visita (${res.status})`);
		return res.json();
	}

	async getResourceStats(slug: string): Promise<{
		downloadCount: number;
		exportCounts: { scorm: number; ims: number; web: number; epub: number };
		favoriteCount: number;
		ratingAvg: number;
		ratingCount: number;
		userFavorited: boolean;
		viewCount?: number;
	}> {
		const res = await fetch(`/api/v1/resources/${slug}/stats`);
		return res.json();
	}

	async reportResource(
		slug: string,
		reason: string,
		description?: string,
	): Promise<{ id: string }> {
		const res = await fetch(`/api/v1/resources/${slug}/report`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({ reason, description }),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw new Error(err.error || "Error al enviar la denuncia");
		}
		return res.json();
	}

	async listReports(opts?: {
		status?: string;
		reason?: string;
		resourceId?: string;
		limit?: number;
		offset?: number;
	}): Promise<PaginatedResult<ReportRecord>> {
		const params = new URLSearchParams();
		if (opts?.status) params.set("status", opts.status);
		if (opts?.reason) params.set("reason", opts.reason);
		if (opts?.resourceId) params.set("resourceId", opts.resourceId);
		if (opts?.limit) params.set("limit", String(opts.limit));
		if (opts?.offset) params.set("offset", String(opts.offset));
		const res = await fetch(`/api/admin/reports?${params}`, {
			credentials: "include",
		});
		return res.json();
	}

	async getReportById(id: string): Promise<ReportRecord | null> {
		const res = await fetch(`/api/admin/reports/${id}`, {
			credentials: "include",
		});
		if (!res.ok) return null;
		return res.json();
	}

	async updateReport(
		id: string,
		data: { status?: string; resolution?: string; actionTaken?: string },
	): Promise<ReportRecord> {
		const res = await fetch(`/api/admin/reports/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify(data),
		});
		return res.json();
	}

	async getBadgeConfig(): Promise<import("./api-client.ts").BadgeConfig> {
		const res = await fetch("/api/v1/config/badges");
		return res.json();
	}

	async getSettings(): Promise<Record<string, string>> {
		const res = await fetch("/api/admin/settings", { credentials: "include" });
		return res.json();
	}

	async updateSettings(
		settings: Record<string, string>,
	): Promise<Record<string, string>> {
		const res = await fetch("/api/admin/settings", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify(settings),
		});
		return res.json();
	}

	async seedResources(
		count: number,
		clean?: boolean,
	): Promise<{ count: number; durationMs: number }> {
		const res = await fetch("/api/dev/seed-resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({ count, clean }),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw new Error(err.error || "Error al generar recursos");
		}
		return res.json();
	}

	// API Tokens (User)
	async listApiTokens(): Promise<ApiTokenRecord[]> {
		const res = await fetch("/api/v1/tokens", { credentials: "include" });
		const body = await res.json();
		return body.data || [];
	}

	async createApiToken(
		name: string,
		expiresAt?: string,
	): Promise<ApiTokenRecord> {
		const res = await fetch("/api/v1/tokens", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({ name, expiresAt }),
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw new Error(err.error || "Error al crear el token de API");
		}
		return res.json();
	}

	async revokeApiToken(id: string): Promise<void> {
		const res = await fetch(`/api/v1/tokens/${id}`, {
			method: "DELETE",
			credentials: "include",
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw new Error(err.error || "Error al revocar el token de API");
		}
	}

	// API Tokens (Admin)
	async listAllApiTokens(filters?: {
		userId?: string;
		status?: "active" | "revoked" | "expired";
	}): Promise<ApiTokenRecord[]> {
		const params = new URLSearchParams();
		if (filters?.userId) params.set("userId", filters.userId);
		if (filters?.status) params.set("status", filters.status);
		const qs = params.toString();
		const res = await fetch(`/api/admin/api-tokens${qs ? `?${qs}` : ""}`, {
			credentials: "include",
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw new Error(err.error || "Error al obtener tokens de API");
		}
		return res.json();
	}

	async revokeApiTokenAdmin(id: string): Promise<void> {
		const res = await fetch(`/api/admin/api-tokens/${id}`, {
			method: "DELETE",
			credentials: "include",
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw new Error(err.error || "Error al revocar token de API (admin)");
		}
	}

	async getGlobalApiTokenStats(): Promise<ApiTokenStats> {
		const res = await fetch("/api/admin/api-tokens/stats", {
			credentials: "include",
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw new Error(err.error || "Error al obtener estadísticas globales");
		}
		return res.json();
	}
}
