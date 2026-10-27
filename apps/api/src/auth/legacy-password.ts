/**
 * Contraseñas heredadas del Procomún anterior (issue #456, ADR-0037 adenda
 * 2026-10-27).
 *
 * El importador de usuarios guarda el hash antiguo en la cuenta de
 * credenciales. Aquí se verifica en el inicio de sesión y, si la contraseña es
 * correcta, se sustituye por el formato propio de better-auth (scrypt). Así
 * nadie tiene que recuperar la contraseña y los hashes antiguos desaparecen a
 * medida que la gente entra.
 *
 * Formatos admitidos:
 * - bcrypt de PHP (`$2y$`, y `$2a$`/`$2b$` por equivalencia).
 * - Drupal 7 (`$S$`): SHA-512 iterado 2^n veces con sal, según
 *   includes/password.inc (`_password_crypt`).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";

const ITOA64 =
	"./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const DRUPAL7_RE = /^\$S\$[./A-Za-z0-9]{52}$/;
/** Longitud de hash que guarda Drupal 7 (DRUPAL_HASH_LENGTH). */
const DRUPAL_HASH_LENGTH = 55;
const DRUPAL_MIN_HASH_COUNT = 7;
const DRUPAL_MAX_HASH_COUNT = 30;
/** Drupal 7 rechaza contraseñas de más de 512 bytes. */
const DRUPAL_MAX_PASSWORD_BYTES = 512;
/** bcrypt solo usa los 72 primeros bytes (PHP los trunca). */
const BCRYPT_MAX_BYTES = 72;

export function isLegacyPasswordHash(hash: string): boolean {
	return BCRYPT_RE.test(hash) || DRUPAL7_RE.test(hash);
}

/** `_password_base64_encode` de Drupal 7. */
function drupalBase64Encode(input: Uint8Array): string {
	const count = input.length;
	let output = "";
	let i = 0;
	do {
		let value = input[i++] ?? 0;
		output += ITOA64[value & 0x3f];
		if (i < count) value |= (input[i] ?? 0) << 8;
		output += ITOA64[(value >> 6) & 0x3f];
		if (i++ >= count) break;
		if (i < count) value |= (input[i] ?? 0) << 16;
		output += ITOA64[(value >> 12) & 0x3f];
		if (i++ >= count) break;
		output += ITOA64[(value >> 18) & 0x3f];
	} while (i < count);
	return output;
}

function drupal7Crypt(password: Uint8Array, stored: string): string | null {
	if (password.length > DRUPAL_MAX_PASSWORD_BYTES) return null;
	const setting = stored.slice(0, 12);
	const countLog2 = ITOA64.indexOf(setting.charAt(3));
	if (countLog2 < DRUPAL_MIN_HASH_COUNT || countLog2 > DRUPAL_MAX_HASH_COUNT) {
		return null;
	}
	const salt = Buffer.from(setting.slice(4, 12), "latin1");
	let count = 2 ** countLog2;
	let digest = createHash("sha512").update(salt).update(password).digest();
	do {
		digest = createHash("sha512").update(digest).update(password).digest();
	} while (--count);
	return (setting + drupalBase64Encode(digest)).slice(0, DRUPAL_HASH_LENGTH);
}

function safeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

async function verifyLegacyHash(
	hash: string,
	password: string,
): Promise<boolean> {
	const bytes = new TextEncoder().encode(password);
	if (DRUPAL7_RE.test(hash)) {
		const computed = drupal7Crypt(bytes, hash);
		return computed !== null && safeEqual(computed, hash);
	}
	if (BCRYPT_RE.test(hash)) {
		// $2y$ (PHP) y $2b$ son el mismo algoritmo. Bun pre-hashea las
		// contraseñas de más de 72 bytes, PHP las trunca: se trunca aquí para
		// obtener el mismo resultado que el Procomún anterior.
		return Bun.password.verify(
			bytes.subarray(0, BCRYPT_MAX_BYTES),
			`$2b$${hash.slice(4)}`,
			"bcrypt",
		);
	}
	return false;
}

/**
 * Sustituto de `password.verify` de better-auth: los hashes antiguos se
 * comprueban con su algoritmo; el resto, con el de better-auth.
 */
export async function verifyPasswordWithLegacy(data: {
	hash: string;
	password: string;
}): Promise<boolean> {
	if (isLegacyPasswordHash(data.hash)) {
		return verifyLegacyHash(data.hash, data.password);
	}
	return verifyPassword(data);
}

/** Lo mínimo del adaptador interno de better-auth que hace falta aquí. */
export interface LegacyPasswordAdapter {
	findAccounts: (userId: string) => Promise<
		Array<{
			accountId: string;
			providerId: string;
			password?: string | null;
		}>
	>;
	updatePassword: (userId: string, hash: string) => Promise<unknown>;
}

/**
 * Tras un inicio de sesión correcto, cambia el hash antiguo por uno de
 * better-auth. Vuelve a verificar la contraseña antes de escribir, así que
 * nunca reemplaza el hash con una contraseña que no le corresponde.
 * Devuelve `true` si ha sustituido el hash.
 */
export async function upgradeLegacyPasswordHash(
	adapter: LegacyPasswordAdapter,
	input: { userId: string; password: string },
): Promise<boolean> {
	const accounts = await adapter.findAccounts(input.userId);
	const credential = accounts.find(
		(account) =>
			account.providerId === "credential" && account.accountId === input.userId,
	);
	const stored = credential?.password;
	if (!stored || !isLegacyPasswordHash(stored)) return false;
	if (!(await verifyLegacyHash(stored, input.password))) return false;
	await adapter.updatePassword(
		input.userId,
		await hashPassword(input.password),
	);
	return true;
}

/** Opciones `emailAndPassword.password` para better-auth. */
export const legacyAwarePasswordOptions = {
	hash: hashPassword,
	verify: verifyPasswordWithLegacy,
};
