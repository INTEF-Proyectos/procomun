import { describe, expect, test } from "bun:test";
import {
	GRAVATAR_DEFAULT_IMAGE,
	gravatarHash,
	gravatarUrl,
	normalizeGravatarEmail,
} from "./gravatar.ts";

// Ejemplo de la documentación de Gravatar
// (https://docs.gravatar.com/api/avatars/hash/): el correo, con un espacio al
// final, se recorta, se pasa a minúsculas y se resume con SHA-256.
const DOCS_EMAIL = "MyEmailAddress@example.com ";
const DOCS_SHA256 =
	"84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee";

/** SHA-256 de referencia, calculado con el `crypto` de Bun y no con el código probado. */
function sha256Hex(value: string): string {
	return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

describe("normalizeGravatarEmail", () => {
	test("recorta los espacios y pasa el correo a minúsculas", () => {
		expect(normalizeGravatarEmail("  Ana.Prueba@Example.ORG\t")).toBe(
			"ana.prueba@example.org",
		);
	});
});

describe("gravatarHash (#514)", () => {
	test("coincide con el ejemplo de la documentación de Gravatar", async () => {
		expect(await gravatarHash(DOCS_EMAIL)).toBe(DOCS_SHA256);
	});

	test("es el SHA-256 hexadecimal del correo normalizado", async () => {
		const email = "docente.prueba@example.org";
		const hash = await gravatarHash(email);

		expect(hash).toBe(sha256Hex(email));
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});

	test("da el mismo hash sin importar espacios ni mayúsculas", async () => {
		const expected = sha256Hex("docente.prueba@example.org");

		expect(await gravatarHash("  Docente.Prueba@EXAMPLE.org  ")).toBe(expected);
		expect(await gravatarHash("DOCENTE.PRUEBA@example.org")).toBe(expected);
	});

	test("no resume el correo sin normalizar", async () => {
		expect(await gravatarHash(DOCS_EMAIL)).not.toBe(sha256Hex(DOCS_EMAIL));
	});

	test("devuelve null si el correo está vacío", async () => {
		expect(await gravatarHash("   ")).toBeNull();
	});

	test("devuelve null sin Web Crypto (página servida sin HTTPS)", async () => {
		expect(await gravatarHash(DOCS_EMAIL, null)).toBeNull();
	});

	test("devuelve null si el resumen falla", async () => {
		const failing = {
			digest: () => Promise.reject(new Error("no disponible")),
		};
		expect(await gravatarHash(DOCS_EMAIL, failing)).toBeNull();
	});
});

describe("gravatarUrl (#514)", () => {
	test("construye la URL de la imagen con el hash, el tamaño y d=mp", async () => {
		expect(await gravatarUrl(DOCS_EMAIL)).toBe(
			`https://www.gravatar.com/avatar/${DOCS_SHA256}?s=80&d=mp`,
		);
	});

	test("respeta el tamaño pedido y mantiene la silueta por defecto", async () => {
		const url = new URL(
			(await gravatarUrl("docente.prueba@example.org", 192)) ?? "",
		);

		expect(url.origin).toBe("https://www.gravatar.com");
		expect(url.pathname).toBe(
			`/avatar/${sha256Hex("docente.prueba@example.org")}`,
		);
		expect(url.searchParams.get("s")).toBe("192");
		expect(url.searchParams.get("d")).toBe(GRAVATAR_DEFAULT_IMAGE);
		expect(GRAVATAR_DEFAULT_IMAGE).toBe("mp");
	});

	test("devuelve null si no se puede calcular el hash", async () => {
		expect(await gravatarUrl("", 80)).toBeNull();
		expect(await gravatarUrl(DOCS_EMAIL, 80, null)).toBeNull();
	});
});
