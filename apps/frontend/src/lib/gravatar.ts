/**
 * URL del avatar de Gravatar (#514).
 *
 * Gravatar busca la imagen por el SHA-256 (o el MD5) del correo recortado y en
 * minúsculas: https://docs.gravatar.com/api/avatars/hash/. Con cualquier otro
 * identificador sirve la imagen por defecto, que es lo que pasaba antes: se
 * usaba un hash propio de 64 bits y todos los usuarios veían la silueta.
 *
 * `crypto.subtle` solo existe en contextos seguros (HTTPS o localhost). Sin él
 * no hay hash y el componente muestra la inicial del nombre.
 */

/** Imagen que devuelve Gravatar si el correo no tiene foto: silueta «mystery person». */
export const GRAVATAR_DEFAULT_IMAGE = "mp";

type Digest = Pick<SubtleCrypto, "digest">;

function defaultSubtle(): Digest | null {
	return globalThis.crypto?.subtle ?? null;
}

/** Normalización que pide Gravatar: sin espacios a los lados y en minúsculas. */
export function normalizeGravatarEmail(email: string): string {
	return email.trim().toLowerCase();
}

/** SHA-256 hexadecimal del correo normalizado, o `null` si no puede calcularse. */
export async function gravatarHash(
	email: string,
	subtle: Digest | null = defaultSubtle(),
): Promise<string | null> {
	const normalized = normalizeGravatarEmail(email);
	if (!normalized || !subtle) return null;
	try {
		const digest = await subtle.digest(
			"SHA-256",
			new TextEncoder().encode(normalized),
		);
		return Array.from(new Uint8Array(digest), (byte) =>
			byte.toString(16).padStart(2, "0"),
		).join("");
	} catch {
		return null;
	}
}

/**
 * URL de la imagen de Gravatar para un correo, con `d=mp` para quien no tenga
 * foto. Devuelve `null` si no puede calcularse el hash.
 */
export async function gravatarUrl(
	email: string,
	size = 80,
	subtle: Digest | null = defaultSubtle(),
): Promise<string | null> {
	const hash = await gravatarHash(email, subtle);
	if (!hash) return null;
	return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=${GRAVATAR_DEFAULT_IMAGE}`;
}
