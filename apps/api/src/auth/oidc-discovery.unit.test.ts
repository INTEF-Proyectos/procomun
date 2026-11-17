import { beforeEach, describe, expect, test } from "bun:test";
import {
	clearOidcDiscoveryCache,
	getCachedOidcEndSessionUrl,
	resolveOidcEndSessionUrl,
	warmOidcEndSessionUrl,
} from "./oidc-discovery.ts";

/**
 * #542: la URL de cierre de sesión se construía como
 * `${OIDC_ISSUER}/connect/endsession`, que es la de Duende IdentityServer.
 * Keycloak, Azure AD y los demás la publican en otra ruta, así que sale del
 * documento de descubrimiento, con `OIDC_END_SESSION_URL` para forzarla.
 */

const ISSUER = "https://sso.example.org";

/** Proveedor de prueba: responde al documento de descubrimiento. */
function fakeProvider(
	document: unknown,
	options: { status?: number } = {},
): { fetch: typeof fetch; calls: string[] } {
	const calls: string[] = [];
	const fetchImpl = (async (input: RequestInfo | URL) => {
		calls.push(String(input));
		return new Response(JSON.stringify(document), {
			status: options.status ?? 200,
			headers: { "Content-Type": "application/json" },
		});
	}) as unknown as typeof fetch;
	return { fetch: fetchImpl, calls };
}

describe("resolveOidcEndSessionUrl (#542)", () => {
	beforeEach(() => {
		clearOidcDiscoveryCache();
	});

	test("lee end_session_endpoint del documento de descubrimiento", async () => {
		// Ruta de Keycloak, distinta de la de Duende.
		const endSession = `${ISSUER}/realms/edu/protocol/openid-connect/logout`;
		const provider = fakeProvider({ end_session_endpoint: endSession });

		const url = await resolveOidcEndSessionUrl(
			{ OIDC_ISSUER: ISSUER },
			provider.fetch,
		);

		expect(url).toBe(endSession);
		expect(provider.calls).toEqual([
			`${ISSUER}/.well-known/openid-configuration`,
		]);
	});

	test("no construye la ruta de Duende por su cuenta", async () => {
		const provider = fakeProvider({
			end_session_endpoint: `${ISSUER}/realms/edu/protocol/openid-connect/logout`,
		});

		const url = await resolveOidcEndSessionUrl(
			{ OIDC_ISSUER: ISSUER },
			provider.fetch,
		);

		expect(url).not.toContain("/connect/endsession");
	});

	test("OIDC_END_SESSION_URL manda y no consulta al proveedor", async () => {
		const forced = "https://sso.example.org/salir";
		const provider = fakeProvider({ end_session_endpoint: "https://otra/x" });

		const url = await resolveOidcEndSessionUrl(
			{ OIDC_ISSUER: ISSUER, OIDC_END_SESSION_URL: forced },
			provider.fetch,
		);

		expect(url).toBe(forced);
		expect(provider.calls).toEqual([]);
	});

	test("sin OIDC_ISSUER devuelve null sin consultar nada", async () => {
		const provider = fakeProvider({});
		expect(await resolveOidcEndSessionUrl({}, provider.fetch)).toBeNull();
		expect(provider.calls).toEqual([]);
	});

	test("un proveedor que no publica end_session_endpoint da null", async () => {
		const provider = fakeProvider({ issuer: ISSUER });
		expect(
			await resolveOidcEndSessionUrl({ OIDC_ISSUER: ISSUER }, provider.fetch),
		).toBeNull();
	});

	test("descarta un end_session_endpoint que no es una URL http(s)", async () => {
		for (const value of ["javascript:alert(1)", "/logout", "", 42, null]) {
			clearOidcDiscoveryCache();
			const provider = fakeProvider({ end_session_endpoint: value });
			expect(
				await resolveOidcEndSessionUrl({ OIDC_ISSUER: ISSUER }, provider.fetch),
			).toBeNull();
		}
	});

	test("el acierto se guarda en caché y no repite la consulta", async () => {
		const endSession = `${ISSUER}/logout`;
		const provider = fakeProvider({ end_session_endpoint: endSession });
		const env = { OIDC_ISSUER: ISSUER };

		expect(await resolveOidcEndSessionUrl(env, provider.fetch)).toBe(
			endSession,
		);
		expect(await resolveOidcEndSessionUrl(env, provider.fetch)).toBe(
			endSession,
		);
		expect(provider.calls).toHaveLength(1);
	});

	test("un fallo no se guarda en caché: el siguiente intento vuelve a probar", async () => {
		const env = { OIDC_ISSUER: ISSUER };
		const caido = fakeProvider({}, { status: 503 });
		expect(await resolveOidcEndSessionUrl(env, caido.fetch)).toBeNull();

		const endSession = `${ISSUER}/logout`;
		const recuperado = fakeProvider({ end_session_endpoint: endSession });
		expect(await resolveOidcEndSessionUrl(env, recuperado.fetch)).toBe(
			endSession,
		);
	});

	test("un error de red da null en vez de reventar", async () => {
		const rota = (async () => {
			throw new Error("ECONNREFUSED");
		}) as unknown as typeof fetch;

		expect(
			await resolveOidcEndSessionUrl({ OIDC_ISSUER: ISSUER }, rota),
		).toBeNull();
	});

	test("una barra final en el issuer no duplica la barra", async () => {
		const provider = fakeProvider({ end_session_endpoint: `${ISSUER}/logout` });
		await resolveOidcEndSessionUrl(
			{ OIDC_ISSUER: `${ISSUER}/` },
			provider.fetch,
		);
		expect(provider.calls).toEqual([
			`${ISSUER}/.well-known/openid-configuration`,
		]);
	});
});

/**
 * El endpoint `/api/v1/config` no debe esperar a la red. Lo descubrió el CI:
 * otro test deja `OIDC_ISSUER` apuntando a un proveedor de prueba ya cerrado
 * —los ficheros de `bun test` comparten proceso— y la petición agotaba el tope
 * de 2 s mientras el endpoint esperaba, así que el test del config se pasaba de
 * su límite.
 */
describe("getCachedOidcEndSessionUrl: nunca espera a la red", () => {
	beforeEach(() => {
		clearOidcDiscoveryCache();
	});

	const ENABLED = { OIDC_ENABLED: "true", OIDC_ISSUER: ISSUER };

	test("con la caché fría devuelve null al momento y calienta por detrás", async () => {
		const endSession = `${ISSUER}/logout`;
		const provider = fakeProvider({ end_session_endpoint: endSession });

		// Sin await: si esto esperase a la red, el valor no seria null.
		expect(getCachedOidcEndSessionUrl(ENABLED, provider.fetch)).toBeNull();

		// El calentado va en segundo plano; despues ya esta en cache.
		await Promise.resolve();
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(getCachedOidcEndSessionUrl(ENABLED, provider.fetch)).toBe(
			endSession,
		);
		expect(provider.calls).toHaveLength(1);
	});

	test("un proveedor que no responde no cuelga la llamada", () => {
		const colgado = (() =>
			new Promise(() => {
				// Nunca resuelve: es el caso del proveedor de prueba ya cerrado.
			})) as unknown as typeof fetch;

		// Lo que fallaba: aqui se esperaban los 2 s del tope.
		expect(getCachedOidcEndSessionUrl(ENABLED, colgado)).toBeNull();
		expect(getCachedOidcEndSessionUrl(ENABLED, colgado)).toBeNull();
	});

	test("no lanza una consulta por llamada", () => {
		const colgado = (() => new Promise(() => {})) as unknown as typeof fetch;
		let calls = 0;
		const contando = ((...args: unknown[]) => {
			calls++;
			return (colgado as (...a: unknown[]) => unknown)(...args);
		}) as unknown as typeof fetch;

		for (let i = 0; i < 5; i++) getCachedOidcEndSessionUrl(ENABLED, contando);
		expect(calls).toBe(1);
	});

	test("sin OIDC activo no consulta nada, aunque haya issuer", () => {
		const provider = fakeProvider({ end_session_endpoint: `${ISSUER}/logout` });

		expect(
			getCachedOidcEndSessionUrl(
				{ OIDC_ENABLED: "false", OIDC_ISSUER: ISSUER },
				provider.fetch,
			),
		).toBeNull();
		expect(provider.calls).toEqual([]);
	});

	test("OIDC_END_SESSION_URL se devuelve al momento y sin consultar", () => {
		const forced = "https://sso.example.org/salir";
		const provider = fakeProvider({ end_session_endpoint: "https://otra/x" });

		expect(
			getCachedOidcEndSessionUrl(
				{ ...ENABLED, OIDC_END_SESSION_URL: forced },
				provider.fetch,
			),
		).toBe(forced);
		expect(provider.calls).toEqual([]);
	});
});

describe("warmOidcEndSessionUrl", () => {
	beforeEach(() => {
		clearOidcDiscoveryCache();
	});

	test("deja la caché lista cuando OIDC está activo", async () => {
		const endSession = `${ISSUER}/logout`;
		const provider = fakeProvider({ end_session_endpoint: endSession });

		await warmOidcEndSessionUrl(
			{ OIDC_ENABLED: "true", OIDC_ISSUER: ISSUER },
			provider.fetch,
		);

		expect(
			getCachedOidcEndSessionUrl(
				{ OIDC_ENABLED: "true", OIDC_ISSUER: ISSUER },
				provider.fetch,
			),
		).toBe(endSession);
	});

	test("sin OIDC activo no consulta nada", async () => {
		const provider = fakeProvider({});
		expect(await warmOidcEndSessionUrl({}, provider.fetch)).toBeNull();
		expect(provider.calls).toEqual([]);
	});
});
