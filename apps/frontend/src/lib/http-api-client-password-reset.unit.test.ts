import { afterEach, describe, expect, test } from "bun:test";
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

// Se restaura el fetch original: dejarlo sustituido rompe cualquier test
// posterior que haga una peticion de verdad. Me paso con el flujo OIDC de
// #515, que habla con un proveedor de prueba y se comia mi stub.
const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

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

	// #551: el servidor responde igual exista o no la cuenta (el envío ya no se
	// espera), así que un error solo puede ser que la recuperación está apagada
	// (sin SMTP) o el límite de peticiones. Decir «enviado» ahí es mentir.
	test("un error del servidor se cuenta: no se ha enviado nada", async () => {
		const { client } = withFetch(
			() =>
				new Response('{"message":"Reset password isn\'t enabled"}', {
					status: 400,
				}),
		);

		expect(await client.requestPasswordReset("a@b.test")).toEqual({
			ok: false,
		});
	});

	test("un fallo de red sí se cuenta, que no es lo mismo", async () => {
		globalThis.fetch = (async () => {
			throw new TypeError("Failed to fetch");
		}) as unknown as typeof fetch;

		const result = await new HttpApiClient().requestPasswordReset("a@b.test");
		expect(result.ok).toBe(false);
	});

	// #551: con /restablecer fijo, quien pide el enlace en inglés o con la app
	// bajo un subdirectorio volvía a una ruta que no es la suya.
	test("la URL de retorno respeta el idioma y la ruta base", async () => {
		const g = globalThis as { document?: unknown };
		const originalDocument = g.document;
		g.document = { documentElement: { lang: "en" } };
		try {
			const { client, calls } = withFetch(ok);
			await client.requestPasswordReset("a@b.test");
			expect(calls[0]?.body).toMatchObject({ redirectTo: "/en/restablecer" });
		} finally {
			g.document = originalDocument;
		}
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

	// #551: un fallo de red se quedaba en una promesa rechazada sin mensaje.
	test("un fallo de red devuelve ok: false en vez de lanzar", async () => {
		globalThis.fetch = (async () => {
			throw new TypeError("Failed to fetch");
		}) as unknown as typeof fetch;

		const result = await new HttpApiClient().resetPassword("t", "contrasena-1");
		expect(result).toEqual({ ok: false });
	});
});
