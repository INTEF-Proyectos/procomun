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

/** El documento de descubrimiento no debe colgar `/api/v1/config`. */
const DISCOVERY_TIMEOUT_MS = 5_000;

/** Solo se guardan los aciertos: un fallo de red se vuelve a intentar. */
const cache = new Map<string, string | null>();

export function clearOidcDiscoveryCache() {
	cache.clear();
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
