/**
 * Visitas de la ficha (ADR-0044, #421): un UUID aleatorio por pestaña en
 * sessionStorage, sin datos personales. Se manda a la API la primera vez que
 * se abre la vista previa de cada recurso; el servidor deduplica igualmente.
 */

const SESSION_KEY = "procomun:view-session";
const VIEWED_PREFIX = "procomun:viewed:";

export function getViewSessionId(storage: Storage): string {
	const existing = storage.getItem(SESSION_KEY);
	if (existing) return existing;
	const created = crypto.randomUUID();
	storage.setItem(SESSION_KEY, created);
	return created;
}

function sessionStorageOrNull(): Storage | null {
	try {
		return typeof window === "undefined" ? null : window.sessionStorage;
	} catch {
		return null;
	}
}

/**
 * Devuelve el total de visitas si esta llamada registró la visita, o null si
 * ya se había contado en la sesión, si falló o si no hay almacenamiento.
 */
export async function trackResourceViewOnce(
	slug: string,
	track: (slug: string, sessionId: string) => Promise<{ viewCount: number }>,
	storage: Storage | null = sessionStorageOrNull(),
): Promise<number | null> {
	if (!storage) return null;
	try {
		const viewedKey = `${VIEWED_PREFIX}${slug}`;
		if (storage.getItem(viewedKey)) return null;
		const { viewCount } = await track(slug, getViewSessionId(storage));
		storage.setItem(viewedKey, "1");
		return viewCount;
	} catch {
		return null;
	}
}
