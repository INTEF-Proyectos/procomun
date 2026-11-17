import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Enlace firmado para ver el contenido .elpx de un recurso no publicado
 * (issue #466, ADR-0026 adenda 2026-10-27).
 *
 * El visor carga el paquete en un iframe de origen opaco. Solo la petición del
 * documento inicial lleva la cookie de sesión: CSS, JS, imágenes, iframes hijos
 * y la navegación a otras páginas del paquete salen sin ella. Por eso el
 * permiso va en la URL: las rutas que ya comprueban el acceso emiten un token
 * HMAC de hash + caducidad y el contenido se reescribe con ese prefijo.
 */

export const ELPX_PREVIEW_TTL_SECONDS = 2 * 60 * 60;
export const ELPX_PREVIEW_PREFIX = "/api/v1/elpx/preview";

// Solo fuera de producción: better-auth ya exige BETTER_AUTH_SECRET en
// producción y aborta el arranque si falta.
const DEV_FALLBACK_SECRET = "procomun-dev-elpx-preview-secret";
const TOKEN_PATTERN = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

function previewSecret(): string | null {
	const secret = process.env.BETTER_AUTH_SECRET || process.env.AUTH_SECRET;
	if (secret) return secret;
	return process.env.NODE_ENV === "production" ? null : DEV_FALLBACK_SECRET;
}

/**
 * Para qué vale un token. Va dentro de lo firmado, así que un token emitido
 * para la vista previa del paquete no vale para una miniatura ni al revés
 * (revisión de #481).
 */
export type SignedTokenPurpose = "elpx-preview" | "thumbnail";

function sign(
	secret: string,
	purpose: SignedTokenPurpose,
	subject: string,
	exp: number,
): string {
	return createHmac("sha256", secret)
		.update(`${purpose}:v1:${subject}:${exp}`)
		.digest("base64url");
}

/** Token `<caducidad>.<firma>` para `subject` (un hash o un fichero). */
export function createSignedToken(
	purpose: SignedTokenPurpose,
	subject: string,
	nowMs: number = Date.now(),
	ttlSeconds: number = ELPX_PREVIEW_TTL_SECONDS,
): string {
	const secret = previewSecret();
	if (!secret) {
		throw new Error("Falta BETTER_AUTH_SECRET para firmar el enlace");
	}
	const exp = Math.floor(nowMs / 1000) + ttlSeconds;
	return `${exp}.${sign(secret, purpose, subject, exp)}`;
}

export function verifySignedToken(
	purpose: SignedTokenPurpose,
	subject: string,
	token: string,
	nowMs: number = Date.now(),
): boolean {
	const match = TOKEN_PATTERN.exec(token);
	if (!match) return false;
	const exp = Number(match[1]);
	if (exp * 1000 <= nowMs) return false;
	const secret = previewSecret();
	if (!secret) return false;
	const expected = Buffer.from(sign(secret, purpose, subject, exp));
	const received = Buffer.from(match[2] as string);
	return (
		expected.length === received.length && timingSafeEqual(expected, received)
	);
}

export function createElpxPreviewToken(
	hash: string,
	nowMs: number = Date.now(),
	ttlSeconds: number = ELPX_PREVIEW_TTL_SECONDS,
): string {
	return createSignedToken("elpx-preview", hash, nowMs, ttlSeconds);
}

export function verifyElpxPreviewToken(
	hash: string,
	token: string,
	nowMs: number = Date.now(),
): boolean {
	return verifySignedToken("elpx-preview", hash, token, nowMs);
}

export function buildSignedElpxPreviewUrl(
	hash: string,
	nowMs: number = Date.now(),
): string {
	return `${ELPX_PREVIEW_PREFIX}/${hash}/${createElpxPreviewToken(hash, nowMs)}/`;
}

/**
 * URL de vista previa según el estado editorial. Publicado: la URL estable de
 * siempre (ficha, «Ponlo en tu web»). Cualquier otro estado: enlace firmado.
 * Llamar solo desde rutas que ya han comprobado que el usuario puede ver el
 * recurso.
 */
export function elpxPreviewUrlForStatus(
	hash: string,
	editorialStatus: string | null | undefined,
	nowMs: number = Date.now(),
): string {
	if (editorialStatus === "published") return `/api/v1/elpx/${hash}/`;
	return buildSignedElpxPreviewUrl(hash, nowMs);
}
