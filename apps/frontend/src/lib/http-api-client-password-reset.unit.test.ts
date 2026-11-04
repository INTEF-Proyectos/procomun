import { describe, expect, test } from "bun:test";
import { HttpApiClient } from "./http-api-client.ts";

/**
 * #531: recuperar la contraseña olvidada. El cliente llama a los endpoints de
 * better-auth 1.7: `/api/auth/request-password-reset` para pedir el correo y
 * `/api/auth/reset-password` para fijar la nueva.
 */
function withFetch(handler: (url: string, init?: RequestInit) => Response): {
	client: HttpApiClient;
	calls: Array<{ url: string; body: unknown }>;
} {
	const calls: Array<{ url: string; body: unknown }> = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		calls.push({
			url,
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
		});
		return handler(url, init);
	}) as typeof fetch;
	return { client: new HttpApiClient(), calls };
}

const ok = () => new Response("{}", { status: 200 });

describe("requestPasswordReset (#531)", () => {
	test("pide el correo con la URL de retorno de la pantalla nueva", async () => {
		const { client, calls } = withFetch(ok);

		const result = await client.requestPasswordReset("autora@ejemplo.test");

		expect(result.ok).toBe(true);
		expect(calls[0]?.url).toContain("/api/auth/request-password-reset");
		expect(calls[0]?.body).toMatchObject({
			email: "autora@ejemplo.test",
			redirectTo: "/restablecer",
		});
	});

	test("responde ok aunque el servidor falle: no se revela si el correo existe", async () => {
		// Un 400 aquí solo puede delatar que la cuenta no está. La interfaz
		// enseña siempre el mismo mensaje.
		const { client } = withFetch(
			() => new Response('{"message":"User not found"}', { status: 400 }),
		);

		expect(await client.requestPasswordReset("no-existe@ejemplo.test")).toEqual(
			{ ok: true },
		);
	});

	test("un fallo de red sí se cuenta, que no es lo mismo", async () => {
		globalThis.fetch = (async () => {
			throw new TypeError("Failed to fetch");
		}) as unknown as typeof fetch;

		const result = await new HttpApiClient().requestPasswordReset("a@b.test");
		expect(result.ok).toBe(false);
		expect(result.error).toBeTruthy();
	});
});

describe("resetPassword (#531)", () => {
	test("manda el token y la contraseña nueva", async () => {
		const { client, calls } = withFetch(ok);

		const result = await client.resetPassword("t-531", "contrasena-nueva-531");

		expect(result.ok).toBe(true);
		expect(calls[0]?.url).toContain("/api/auth/reset-password");
		expect(calls[0]?.body).toMatchObject({
			token: "t-531",
			newPassword: "contrasena-nueva-531",
		});
	});

	test("propaga el error de un enlace caducado o ya usado", async () => {
		const { client } = withFetch(
			() => new Response('{"message":"invalid token"}', { status: 400 }),
		);

		const result = await client.resetPassword("caducado", "otra-contrasena");
		expect(result.ok).toBe(false);
		expect(result.error).toContain("invalid token");
	});
});
