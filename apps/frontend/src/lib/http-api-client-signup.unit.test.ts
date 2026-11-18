import { afterEach, describe, expect, mock, test } from "bun:test";
import { HttpApiClient } from "./http-api-client.ts";

type FetchCall = {
	url: string;
	init?: RequestInit;
};

function jsonResponse(
	body: unknown,
	status = 200,
	headers?: HeadersInit,
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json", ...headers },
	});
}

function emptyResponse(status = 200, headers?: HeadersInit): Response {
	const body = status === 204 || status === 304 ? null : "";
	return new Response(body, { status, headers });
}

function bodyAsJson(call: FetchCall): unknown {
	return JSON.parse(call.init?.body as string);
}

function getCall(calls: FetchCall[], index: number): FetchCall {
	const call = calls[index];
	if (!call) throw new Error(`Expected fetch call at index ${index}`);
	return call;
}

function mockFetchQueue(responses: Response[]): FetchCall[] {
	const calls: FetchCall[] = [];
	globalThis.fetch = mock(
		async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), init });
			const response = responses.shift();
			if (!response) throw new Error(`Unexpected fetch call: ${String(url)}`);
			return response;
		},
	) as unknown as typeof fetch;
	return calls;
}

describe("HttpApiClient.signUp", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		mock.restore();
		globalThis.fetch = originalFetch;
	});

	test("calls /api/auth/sign-up/email with name, email, password and verification callback", async () => {
		let capturedUrl = "";
		let capturedInit: RequestInit | undefined;

		globalThis.fetch = mock(
			async (url: string | URL | Request, init?: RequestInit) => {
				capturedUrl = url as string;
				capturedInit = init;
				return new Response(JSON.stringify({ user: { id: "u1" } }), {
					status: 200,
				});
			},
		) as unknown as typeof fetch;

		const client = new HttpApiClient();
		const result = await client.signUp(
			"Test User",
			"test@example.com",
			"password123",
			"/perfil?verified=1",
		);

		expect(result.ok).toBe(true);
		expect(capturedUrl).toBe("/api/auth/sign-up/email");
		expect(capturedInit?.method).toBe("POST");
		expect(capturedInit?.credentials).toBe("include");
		const body = JSON.parse(capturedInit?.body as string);
		expect(body.name).toBe("Test User");
		expect(body.email).toBe("test@example.com");
		expect(body.password).toBe("password123");
		expect(body.callbackURL).toBe("/perfil?verified=1");
	});

	test("returns error when sign-up fails (e.g. email already exists)", async () => {
		globalThis.fetch = mock(async () => {
			return new Response(JSON.stringify({ message: "User already exists" }), {
				status: 422,
			});
		}) as unknown as typeof fetch;

		const client = new HttpApiClient();
		const result = await client.signUp(
			"Test User",
			"existing@example.com",
			"password123",
		);

		expect(result.ok).toBe(false);
		expect(result.error).toBe("User already exists");
	});

	test("returns default error message when response has no message", async () => {
		globalThis.fetch = mock(async () => {
			return new Response("", { status: 500 });
		}) as unknown as typeof fetch;

		const client = new HttpApiClient();
		const result = await client.signUp(
			"Test User",
			"test@example.com",
			"password123",
		);

		expect(result.ok).toBe(false);
		expect(result.error).toBe("Error al crear la cuenta");
	});
});

describe("HttpApiClient", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		mock.restore();
		globalThis.fetch = originalFetch;
	});

	test("fetches public resources, collections, config and stats", async () => {
		const calls = mockFetchQueue([
			jsonResponse({ data: [{ id: "r1" }], total: 1 }),
			jsonResponse({ id: "r1", slug: "algebra" }),
			emptyResponse(404),
			jsonResponse({ data: [{ id: "c1" }], total: 1 }),
			jsonResponse({ id: "c1", slug: "stem" }),
			emptyResponse(404),
			jsonResponse({
				oidcEnabled: true,
				emailVerificationRequired: false,
				emailDeliveryEnabled: true,
			}),
			jsonResponse({ users: 7 }),
		]);
		const client = new HttpApiClient();

		await expect(
			client.listResources({
				q: "algebra",
				limit: 10,
				offset: 5,
				resourceType: "lesson",
				language: "es",
				license: "cc-by",
			}),
		).resolves.toMatchObject({ data: [{ id: "r1" }], total: 1 });
		await expect(client.getResourceBySlug("algebra")).resolves.toMatchObject({
			id: "r1",
			slug: "algebra",
		});
		await expect(client.getResourceBySlug("missing")).resolves.toBeNull();
		await expect(
			client.listPublicCollections({ q: "stem", limit: 20, offset: 2 }),
		).resolves.toMatchObject({
			data: [{ id: "c1" }],
			total: 1,
		});
		await expect(
			client.getPublicCollectionBySlug("stem"),
		).resolves.toMatchObject({
			id: "c1",
			slug: "stem",
		});
		await expect(
			client.getPublicCollectionBySlug("missing"),
		).resolves.toBeNull();
		await expect(client.getConfig()).resolves.toMatchObject({
			oidcEnabled: true,
		});
		await expect(client.getPlatformStats()).resolves.toMatchObject({
			users: 7,
		});

		expect(calls.map((call) => call.url)).toEqual([
			"/api/v1/resources?q=algebra&limit=10&offset=5&resourceType=lesson&language=es&license=cc-by",
			"/api/v1/resources/algebra",
			"/api/v1/resources/missing",
			"/api/v1/collections?q=stem&limit=20&offset=2",
			"/api/v1/collections/stem",
			"/api/v1/collections/missing",
			"/api/v1/config",
			"/api/v1/stats",
		]);
	});

	test("signIn devuelve el código de cuenta bloqueada (#456)", async () => {
		mockFetchQueue([
			jsonResponse(
				{ code: "BANNED_USER", message: "Tu cuenta está bloqueada." },
				403,
			),
		]);
		const client = new HttpApiClient();

		await expect(
			client.signIn("bloqueada@example.com", "secret"),
		).resolves.toEqual({
			ok: false,
			code: "BANNED_USER",
			error: "Tu cuenta está bloqueada.",
		});
	});

	test("handles session and sign-in flows", async () => {
		const calls = mockFetchQueue([
			emptyResponse(401),
			jsonResponse({}),
			jsonResponse({ user: { id: "u1" } }),
			jsonResponse({}),
			jsonResponse({ message: "Bad credentials" }, 401),
			emptyResponse(302, { location: "/admin" }),
			jsonResponse({ url: "/oidc" }),
			emptyResponse(500),
			emptyResponse(204),
		]);
		const client = new HttpApiClient();

		await expect(client.getSession()).resolves.toBeNull();
		await expect(client.getSession()).resolves.toBeNull();
		await expect(client.getSession()).resolves.toMatchObject({
			user: { id: "u1" },
		});
		const throwingFetch = globalThis.fetch;
		globalThis.fetch = mock(async () => {
			throw new Error("network");
		}) as unknown as typeof fetch;
		await expect(client.getSession()).resolves.toBeNull();
		globalThis.fetch = throwingFetch;

		await expect(
			client.signIn("user@example.com", "secret"),
		).resolves.toMatchObject({
			ok: true,
		});
		await expect(
			client.signIn("user@example.com", "bad"),
		).resolves.toMatchObject({
			ok: false,
			error: "Bad credentials",
		});
		await expect(client.signInOidc()).resolves.toMatchObject({
			ok: true,
			redirectUrl: "/admin",
		});
		await expect(client.signInOidc()).resolves.toMatchObject({
			ok: true,
			redirectUrl: "/oidc",
		});
		await expect(client.signInOidc()).resolves.toMatchObject({
			ok: false,
			error: "No se pudo iniciar el login institucional",
		});
		await client.signOut();

		expect(getCall(calls, 0).init?.credentials).toBe("include");
		expect(getCall(calls, 3).url).toBe("/api/auth/sign-in/email");
		expect(getCall(calls, 3).init?.method).toBe("POST");
		expect(bodyAsJson(getCall(calls, 3))).toEqual({
			email: "user@example.com",
			password: "secret",
		});
		// El flujo completo contra Better Auth está en
		// apps/api/src/auth/oidc-sign-in.integration.test.ts (#527).
		expect(getCall(calls, 5).url).toBe("/api/auth/sign-in/social");
		expect(bodyAsJson(getCall(calls, 5))).toEqual({
			provider: "oidc",
			callbackURL: "/admin",
		});
		expect(getCall(calls, 8)).toMatchObject({
			url: "/api/auth/sign-out",
			init: { method: "POST", credentials: "include" },
		});
	});

	test("covers admin resource and upload operations", async () => {
		const calls = mockFetchQueue([
			jsonResponse({ data: [{ id: "r1" }], total: 1 }),
			emptyResponse(500),
			jsonResponse({ id: "r1" }),
			emptyResponse(404),
			jsonResponse([{ id: "m1" }]),
			emptyResponse(404),
			jsonResponse([{ id: "up1" }]),
			emptyResponse(404),
			jsonResponse({ id: "draft", slug: "draft" }, 201),
			jsonResponse({ error: "no draft" }, 500),
			jsonResponse({ id: "created", slug: "created" }, 201),
			jsonResponse({ error: "invalid" }, 400),
			jsonResponse({ ok: true }),
			jsonResponse({ error: "invalid", details: ["title"] }, 400),
			jsonResponse({ id: "r1", status: "published" }),
			jsonResponse({ error: "bad transition" }, 400),
			emptyResponse(204),
			jsonResponse({ maxFileSizeBytes: 1_000 }),
			jsonResponse({ id: "up1", cancelled: true }),
			jsonResponse({ error: "missing upload" }, 404),
			jsonResponse({ id: "m1", deleted: true }),
			jsonResponse({}, 500),
			jsonResponse({ id: "p1" }),
			emptyResponse(404),
			jsonResponse({ id: "p2" }),
			jsonResponse({}, 500),
		]);
		const client = new HttpApiClient();

		await expect(
			client.listAdminResources({
				q: "math",
				limit: 0,
				offset: 0,
				status: "review",
			}),
		).resolves.toMatchObject({
			data: [{ id: "r1" }],
			total: 1,
		});
		await expect(client.listAdminResources()).rejects.toThrow(
			"listAdminResources failed: 500",
		);
		await expect(client.getResourceById("r1")).resolves.toMatchObject({
			id: "r1",
		});
		await expect(client.getResourceById("missing")).resolves.toBeNull();
		await expect(client.listResourceMediaItems("r1")).resolves.toMatchObject([
			{ id: "m1" },
		]);
		await expect(
			client.listResourceMediaItems("missing"),
		).resolves.toMatchObject([]);
		await expect(client.listResourceUploads("r1")).resolves.toMatchObject([
			{ id: "up1" },
		]);
		await expect(client.listResourceUploads("missing")).resolves.toMatchObject(
			[],
		);
		await expect(client.createDraftResource()).resolves.toMatchObject({
			id: "draft",
			slug: "draft",
		});
		await expect(client.createDraftResource()).rejects.toThrow("no draft");
		await expect(
			client.createResource({ title: "T" } as never),
		).resolves.toMatchObject({ id: "created", slug: "created" });
		await expect(client.createResource({ title: "" } as never)).rejects.toEqual(
			{ error: "invalid" },
		);
		await expect(
			client.updateResource("r1", { title: "Updated" } as never),
		).resolves.toMatchObject({ ok: true });
		await expect(
			client.updateResource("r1", {} as never),
		).resolves.toMatchObject({
			ok: false,
			error: "invalid",
			details: ["title"],
		});
		await expect(
			client.updateResourceStatus("r1", "published"),
		).resolves.toMatchObject({ id: "r1", status: "published" });
		await expect(client.updateResourceStatus("r1", "archived")).rejects.toEqual(
			{ error: "bad transition" },
		);
		await client.deleteResource("r1");
		await expect(client.getUploadConfig()).resolves.toMatchObject({
			maxFileSizeBytes: 1_000,
		});
		await expect(client.cancelUpload("up1")).resolves.toMatchObject({
			id: "up1",
			cancelled: true,
		});
		await expect(client.cancelUpload("missing")).rejects.toEqual({
			error: "missing upload",
		});
		await expect(client.deleteMediaItem("r1", "m1")).resolves.toMatchObject({
			id: "m1",
			deleted: true,
		});
		await expect(client.deleteMediaItem("r1", "m2")).rejects.toThrow(
			"Error al eliminar el archivo",
		);
		await expect(client.getElpxProject("r1")).resolves.toMatchObject({
			id: "p1",
		});
		await expect(client.getElpxProject("missing")).resolves.toBeNull();
		await expect(client.generateElpx("r1")).resolves.toMatchObject({
			id: "p2",
		});
		await expect(client.generateElpx("r1")).rejects.toThrow(
			"Error al generar el .elpx",
		);

		expect(getCall(calls, 0).url).toBe(
			"/api/admin/resources?q=math&limit=0&offset=0&status=review",
		);
		expect(getCall(calls, 8)).toMatchObject({
			url: "/api/admin/resources/draft",
			init: { method: "POST", credentials: "include" },
		});
		expect(getCall(calls, 10).url).toBe("/api/admin/resources");
		expect(bodyAsJson(getCall(calls, 10))).toEqual({ title: "T" });
		expect(getCall(calls, 14).url).toBe("/api/admin/resources/r1/status");
		expect(bodyAsJson(getCall(calls, 14))).toEqual({ status: "published" });
		expect(getCall(calls, 16).init?.method).toBe("DELETE");
		expect(getCall(calls, 24).url).toBe("/api/admin/elpx/generate/r1");
	});

	test("covers users, collections and taxonomies", async () => {
		const calls = mockFetchQueue([
			jsonResponse({ data: [{ id: "u1" }], total: 1 }),
			jsonResponse({ id: "u1" }),
			emptyResponse(404),
			jsonResponse({ ok: true }),
			jsonResponse({}, 500),
			jsonResponse({ data: [{ id: "c1" }], total: 1 }),
			jsonResponse({ id: "c1" }),
			emptyResponse(404),
			jsonResponse([{ resourceId: "r1" }]),
			emptyResponse(404),
			jsonResponse({ id: "c2" }, 201),
			jsonResponse({ error: "collection invalid" }, 400),
			jsonResponse({ ok: true }),
			jsonResponse({ error: "bad collection", details: ["title"] }, 400),
			emptyResponse(204),
			jsonResponse({ ok: true }),
			jsonResponse({ error: "already linked" }, 409),
			jsonResponse({ ok: true }),
			jsonResponse({ error: "missing link" }, 404),
			jsonResponse({ ok: true }),
			jsonResponse({}, 409),
			jsonResponse({ data: [{ id: "t1" }], total: 1 }),
			jsonResponse({ id: "t1" }),
			emptyResponse(404),
			jsonResponse({ id: "t2" }, 201),
			jsonResponse({ error: "taxonomy invalid" }, 400),
			jsonResponse({ ok: true }),
			jsonResponse({ error: "bad taxonomy", details: ["name"] }, 400),
			emptyResponse(204),
		]);
		const client = new HttpApiClient();

		await expect(
			client.listUsers({ q: "ana", role: "admin", limit: 10, offset: 5 }),
		).resolves.toMatchObject({
			data: [{ id: "u1" }],
			total: 1,
		});
		await expect(client.getUserById("u1")).resolves.toMatchObject({ id: "u1" });
		await expect(client.getUserById("missing")).resolves.toBeNull();
		await expect(
			client.updateUser("u1", { name: "Ana", isActive: true }),
		).resolves.toMatchObject({ ok: true });
		await expect(
			client.updateUser("u1", { role: "admin" }),
		).resolves.toMatchObject({
			ok: false,
			error: "Error al actualizar usuario",
		});
		await expect(
			client.listCollections({ q: "stem", limit: 10, offset: 2 }),
		).resolves.toMatchObject({
			data: [{ id: "c1" }],
			total: 1,
		});
		await expect(client.getCollectionById("c1")).resolves.toMatchObject({
			id: "c1",
		});
		await expect(client.getCollectionById("missing")).resolves.toBeNull();
		await expect(client.listCollectionResources("c1")).resolves.toMatchObject([
			{ resourceId: "r1" },
		]);
		await expect(
			client.listCollectionResources("missing"),
		).resolves.toMatchObject([]);
		await expect(
			client.createCollection({ title: "C", description: "D" }),
		).resolves.toMatchObject({ id: "c2" });
		await expect(
			client.createCollection({ title: "", description: "" }),
		).rejects.toEqual({ error: "collection invalid" });
		await expect(
			client.updateCollection("c1", { title: "New" }),
		).resolves.toMatchObject({ ok: true });
		await expect(client.updateCollection("c1", {})).resolves.toMatchObject({
			ok: false,
			error: "bad collection",
			details: ["title"],
		});
		await client.deleteCollection("c1");
		await expect(
			client.addResourceToCollection("c1", "r1"),
		).resolves.toMatchObject({
			ok: true,
		});
		await expect(client.addResourceToCollection("c1", "r1")).rejects.toEqual({
			error: "already linked",
		});
		await expect(
			client.removeResourceFromCollection("c1", "r1"),
		).resolves.toMatchObject({ ok: true });
		await expect(
			client.removeResourceFromCollection("c1", "r2"),
		).rejects.toEqual({ error: "missing link" });
		await expect(
			client.reorderCollectionResource("c1", "r1", "up"),
		).resolves.toMatchObject({ ok: true });
		await expect(
			client.reorderCollectionResource("c1", "r1", "down"),
		).resolves.toMatchObject({
			ok: false,
			error: "No se pudo reordenar el recurso",
		});
		await expect(
			client.listTaxonomies({ q: "eso", type: "level", limit: 10, offset: 1 }),
		).resolves.toMatchObject({
			data: [{ id: "t1" }],
			total: 1,
		});
		await expect(client.getTaxonomyById("t1")).resolves.toMatchObject({
			id: "t1",
		});
		await expect(client.getTaxonomyById("missing")).resolves.toBeNull();
		await expect(
			client.createTaxonomy({ name: "ESO", type: "level" }),
		).resolves.toMatchObject({ id: "t2" });
		await expect(client.createTaxonomy({ name: "" })).rejects.toEqual({
			error: "taxonomy invalid",
		});
		await expect(
			client.updateTaxonomy("t1", { name: "Primaria" }),
		).resolves.toMatchObject({ ok: true });
		await expect(client.updateTaxonomy("t1", {})).resolves.toMatchObject({
			ok: false,
			error: "bad taxonomy",
			details: ["name"],
		});
		await client.deleteTaxonomy("t1");

		expect(getCall(calls, 0).url).toBe(
			"/api/admin/users?q=ana&role=admin&limit=10&offset=5",
		);
		expect(getCall(calls, 3).init?.method).toBe("PATCH");
		expect(bodyAsJson(getCall(calls, 3))).toEqual({
			name: "Ana",
			isActive: true,
		});
		expect(getCall(calls, 5).url).toBe(
			"/api/admin/collections?q=stem&limit=10&offset=2",
		);
		expect(getCall(calls, 15).url).toBe("/api/admin/collections/c1/resources");
		expect(bodyAsJson(getCall(calls, 15))).toEqual({ resourceId: "r1" });
		expect(getCall(calls, 19).url).toBe(
			"/api/admin/collections/c1/resources/reorder",
		);
		expect(bodyAsJson(getCall(calls, 19))).toEqual({
			resourceId: "r1",
			direction: "up",
		});
		expect(getCall(calls, 21).url).toBe(
			"/api/admin/taxonomies?q=eso&type=level&limit=10&offset=1",
		);
	});

	test("covers social endpoints, settings and development seeding", async () => {
		const calls = mockFetchQueue([
			jsonResponse({ avg: 4 }),
			jsonResponse({ score: 5 }, 201),
			jsonResponse({ error: "login required" }, 401),
			jsonResponse({ favorited: true }),
			jsonResponse({ data: [{ id: "r1" }], total: 1 }),
			jsonResponse({ data: [{ id: "r2" }], total: 1 }),
			jsonResponse({ resources: 3 }),
			jsonResponse({ data: [{ id: "a1" }], total: 1 }),
			jsonResponse({ count: 9 }),
			jsonResponse({ downloadCount: 9 }),
			jsonResponse({ showQualityBadges: "true" }),
			jsonResponse({ siteName: "Procomun" }),
			jsonResponse({ siteName: "Nuevo" }),
			jsonResponse({ count: 4, durationMs: 12 }),
			jsonResponse({}, 500),
		]);
		const client = new HttpApiClient();

		await expect(client.getResourceRatings("algebra")).resolves.toMatchObject({
			avg: 4,
		});
		await expect(client.submitRating("algebra", 5)).resolves.toMatchObject({
			score: 5,
		});
		await expect(client.submitRating("algebra", 1)).rejects.toEqual({
			error: "login required",
		});
		await expect(client.toggleFavorite("algebra")).resolves.toMatchObject({
			favorited: true,
		});
		await expect(
			client.getUserFavorites({ limit: 10, offset: 5 }),
		).resolves.toMatchObject({
			data: [{ id: "r1" }],
			total: 1,
		});
		await expect(
			client.getUserRatings({ limit: 20, offset: 10 }),
		).resolves.toMatchObject({
			data: [{ id: "r2" }],
			total: 1,
		});
		await expect(client.getUserDashboard()).resolves.toMatchObject({
			resources: 3,
		});
		await expect(
			client.getUserActivity({ limit: 5, offset: 1 }),
		).resolves.toMatchObject({
			data: [{ id: "a1" }],
			total: 1,
		});
		await expect(client.trackDownload("algebra")).resolves.toMatchObject({
			count: 9,
		});
		await expect(client.getResourceStats("algebra")).resolves.toMatchObject({
			downloadCount: 9,
		});
		await expect(client.getBadgeConfig()).resolves.toMatchObject({
			showQualityBadges: "true",
		});
		await expect(client.getSettings()).resolves.toMatchObject({
			siteName: "Procomun",
		});
		await expect(
			client.updateSettings({ siteName: "Nuevo" }),
		).resolves.toMatchObject({ siteName: "Nuevo" });
		await expect(client.seedResources(4, true)).resolves.toMatchObject({
			count: 4,
			durationMs: 12,
		});
		await expect(client.seedResources(1)).rejects.toThrow(
			"Error al generar recursos",
		);

		expect(getCall(calls, 1).url).toBe("/api/v1/resources/algebra/ratings");
		expect(getCall(calls, 1).init?.method).toBe("POST");
		expect(bodyAsJson(getCall(calls, 1))).toEqual({ score: 5 });
		expect(getCall(calls, 4).url).toBe(
			"/api/v1/users/me/favorites?limit=10&offset=5",
		);
		expect(getCall(calls, 5).url).toBe(
			"/api/v1/users/me/ratings?limit=20&offset=10",
		);
		expect(getCall(calls, 7).url).toBe(
			"/api/v1/users/me/activity?limit=5&offset=1",
		);
		expect(bodyAsJson(getCall(calls, 8))).toEqual({ format: "direct" });
		expect(getCall(calls, 12).url).toBe("/api/admin/settings");
		expect(getCall(calls, 12).init?.method).toBe("PUT");
		expect(bodyAsJson(getCall(calls, 12))).toEqual({ siteName: "Nuevo" });
		expect(getCall(calls, 13).url).toBe("/api/dev/seed-resources");
		expect(bodyAsJson(getCall(calls, 13))).toEqual({ count: 4, clean: true });
		expect(bodyAsJson(getCall(calls, 14))).toEqual({ count: 1 });
	});

	test("covers user and admin API token endpoints", async () => {
		const calls = mockFetchQueue([
			jsonResponse({ data: [{ id: "token-1", name: "CLI" }] }),
			jsonResponse({ id: "token-2", name: "Import", token: "pck_secret" }, 201),
			jsonResponse({ error: "invalid token name" }, 400),
			emptyResponse(204),
			jsonResponse({}, 500),
			jsonResponse([{ id: "token-3", userId: "u1" }]),
			jsonResponse({ error: "admin only" }, 403),
			jsonResponse({ success: true }),
			jsonResponse({}, 500),
			jsonResponse({ total: 3, active: 2, revoked: 1, expired: 0 }),
			jsonResponse({}, 500),
		]);
		const client = new HttpApiClient();

		await expect(client.listApiTokens()).resolves.toMatchObject([
			{ id: "token-1", name: "CLI" },
		]);
		await expect(
			client.createApiToken("Import", "2030-01-01T00:00:00.000Z"),
		).resolves.toMatchObject({
			id: "token-2",
			name: "Import",
			token: "pck_secret",
		});
		await expect(client.createApiToken("")).rejects.toThrow(
			"invalid token name",
		);
		await expect(client.revokeApiToken("token-1")).resolves.toBeUndefined();
		await expect(client.revokeApiToken("missing")).rejects.toThrow(
			"Error al revocar el token de API",
		);
		await expect(
			client.listAllApiTokens({ userId: "u1", status: "active" }),
		).resolves.toMatchObject([{ id: "token-3", userId: "u1" }]);
		await expect(client.listAllApiTokens()).rejects.toThrow("admin only");
		await expect(
			client.revokeApiTokenAdmin("token-3"),
		).resolves.toBeUndefined();
		await expect(client.revokeApiTokenAdmin("missing")).rejects.toThrow(
			"Error al revocar token de API (admin)",
		);
		await expect(client.getGlobalApiTokenStats()).resolves.toMatchObject({
			total: 3,
			active: 2,
			revoked: 1,
			expired: 0,
		});
		await expect(client.getGlobalApiTokenStats()).rejects.toThrow(
			"Error al obtener estadísticas globales",
		);

		expect(getCall(calls, 0).url).toBe("/api/v1/tokens");
		expect(getCall(calls, 0).init?.credentials).toBe("include");
		expect(getCall(calls, 1).url).toBe("/api/v1/tokens");
		expect(getCall(calls, 1).init?.method).toBe("POST");
		expect(bodyAsJson(getCall(calls, 1))).toEqual({
			name: "Import",
			expiresAt: "2030-01-01T00:00:00.000Z",
		});
		expect(getCall(calls, 3)).toMatchObject({
			url: "/api/v1/tokens/token-1",
			init: { method: "DELETE", credentials: "include" },
		});
		expect(getCall(calls, 5).url).toBe(
			"/api/admin/api-tokens?userId=u1&status=active",
		);
		expect(getCall(calls, 7)).toMatchObject({
			url: "/api/admin/api-tokens/token-3",
			init: { method: "DELETE", credentials: "include" },
		});
		expect(getCall(calls, 9).url).toBe("/api/admin/api-tokens/stats");
	});
});

describe("HttpApiClient.trackResourceView (#421)", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		mock.restore();
		globalThis.fetch = originalFetch;
	});

	test("manda el identificador de sesión y devuelve el total", async () => {
		const calls = mockFetchQueue([
			jsonResponse({ viewCount: 3 }),
			jsonResponse({ error: "Recurso no encontrado" }, 404),
		]);
		const client = new HttpApiClient();
		const sessionId = "6f1d9a52-1c1e-4b4c-9f0e-0a1b2c3d4e5f";

		await expect(
			client.trackResourceView("algebra", sessionId),
		).resolves.toEqual({ viewCount: 3 });
		expect(getCall(calls, 0)).toMatchObject({
			url: "/api/v1/resources/algebra/view",
			init: { method: "POST" },
		});
		expect(bodyAsJson(getCall(calls, 0))).toEqual({ sessionId });

		await expect(
			client.trackResourceView("borrador", sessionId),
		).rejects.toThrow();
	});
});
