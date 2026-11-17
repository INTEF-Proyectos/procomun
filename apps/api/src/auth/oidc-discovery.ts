/**
 * URL de cierre de sesión del proveedor OIDC (issue #542).
 *
 * Antes se construía como `${OIDC_ISSUER}/connect/endsession`, que es la ruta
 * de Duende IdentityServer, el proveedor de demostración. Keycloak, Azure AD y
 * los demás la publican en otra ruta, así que con ellos el cierre de sesión
 * institucional no funcionaba. Ahora sale de `end_session_endpoint` del
 * documento de descubrimiento, que es donde la especificación de OpenID
 * Connect Session Management dice que está, y `OIDC_END_SESSION_URL` la fuerza
 * para un proveedor que no la publique.
 */

/** Tope de la consulta. Nunca la espera `/api/v1/config`: ver más abajo. */
const DISCOVERY_TIMEOUT_MS = 2_000;

/** Consultas en vuelo, para no lanzar una por petición. */
const inFlight = new Map<string, Promise<string | null>>();

/** Solo se guardan los aciertos: un fallo de red se vuelve a intentar. */
const cache = new Map<string, string | null>();

export function clearOidcDiscoveryCache() {
	cache.clear();
	// También las consultas en vuelo: si quedara una, su promesa seguiría
	// bloqueando los reintentos de ese issuer para el resto del proceso.
	inFlight.clear();
}

/** Una URL absoluta http(s), para no devolver `javascript:` ni una ruta suelta. */
function asHttpUrl(value: unknown): string | null {
	if (typeof value !== "string" || value.length === 0) return null;
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:" ? value : null;
	} catch {
		return null;
	}
}

export function discoveryUrlFor(issuer: string): string {
	return `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;
}

export async function resolveOidcEndSessionUrl(
	env: Record<string, string | undefined>,
	fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
	const forced = asHttpUrl(env.OIDC_END_SESSION_URL);
	if (forced) return forced;

	const issuer = env.OIDC_ISSUER;
	if (!issuer) return null;

	const discoveryUrl = discoveryUrlFor(issuer);
	const cached = cache.get(discoveryUrl);
	if (cached !== undefined) return cached;

	try {
		const res = await fetchImpl(discoveryUrl, {
			signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
		});
		if (!res.ok) return null;

		const document = (await res.json()) as { end_session_endpoint?: unknown };
		const endSessionUrl = asHttpUrl(document.end_session_endpoint);
		// Se guarda también el null de un proveedor que responde y no la publica:
		// es su configuración, no un fallo pasajero.
		cache.set(discoveryUrl, endSessionUrl);
		return endSessionUrl;
	} catch {
		return null;
	}
}

/**
 * URL de cierre de sesión **sin esperar a la red**, para servir
 * `/api/v1/config`.
 *
 * Que un endpoint dependa de una petición a un tercero es un defecto: lo pagan
 * su latencia y su previsibilidad. Lo descubrió el CI, donde otro test deja
 * `OIDC_ISSUER` apuntando a un proveedor de prueba ya cerrado —los ficheros de
 * `bun test` comparten proceso— y la petición agotaba el tope mientras el
 * endpoint esperaba.
 *
 * Así que esto solo lee la caché. Si está fría, lanza el calentado en segundo
 * plano y devuelve `null` esta vez: la interfaz no ofrece el cierre de sesión
 * del proveedor hasta que se sepa, que es el mismo comportamiento que cuando el
 * proveedor no lo publica. `warmOidcEndSessionUrl` lo calienta al arrancar, así
 * que en la práctica ya está resuelto cuando alguien cierra sesión.
 */
export function getCachedOidcEndSessionUrl(
	env: Record<string, string | undefined>,
	fetchImpl: typeof fetch = fetch,
): string | null {
	const forced = asHttpUrl(env.OIDC_END_SESSION_URL);
	if (forced) return forced;
	// Sin OIDC activo la URL no sirve de nada: no se consulta nada.
	if (env.OIDC_ENABLED !== "true" || !env.OIDC_ISSUER) return null;

	const discoveryUrl = discoveryUrlFor(env.OIDC_ISSUER);
	const cached = cache.get(discoveryUrl);
	if (cached !== undefined) return cached;

	if (!inFlight.has(discoveryUrl)) {
		inFlight.set(
			discoveryUrl,
			resolveOidcEndSessionUrl(env, fetchImpl).finally(() => {
				inFlight.delete(discoveryUrl);
			}),
		);
	}
	return null;
}

/** Calienta la caché al arrancar. Un fallo no impide arrancar. */
export async function warmOidcEndSessionUrl(
	env: Record<string, string | undefined> = process.env,
	fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
	if (env.OIDC_ENABLED !== "true") return null;
	return resolveOidcEndSessionUrl(env, fetchImpl);
}
