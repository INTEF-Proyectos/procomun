import { afterEach, describe, expect, test } from "bun:test";
import { HttpApiClient } from "./http-api-client.ts";

/**
 * #532: pestaña «Cuenta». El cliente habla con los endpoints de Better Auth
 * 1.7: /change-password, /change-email y /list-accounts.
 */

// Restaurar el fetch original: dejarlo sustituido rompe cualquier test
// posterior que haga una petición de verdad (me pasó en #531).
const originalFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = originalFetch;
});

function withFetch(handler: (url: string) => Response) {
	const calls: Array<{ url: string; body: unknown }> = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		calls.push({
			url,
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
		});
		return handler(url);
	}) as unknown as typeof fetch;
	return { client: new HttpApiClient(), calls };
}

describe("changePassword (#532)", () => {
	test("manda la actual y la nueva, y cierra las demás sesiones", async () => {
		const { client, calls } = withFetch(
			() => new Response("{}", { status: 200 }),
		);

		const result = await client.changePassword("actual-1234", "nueva-12345");

		expect(result.ok).toBe(true);
		expect(calls[0]?.url).toContain("/api/auth/change-password");
		expect(calls[0]?.body).toEqual({
			currentPassword: "actual-1234",
			newPassword: "nueva-12345",
			revokeOtherSessions: true,
		});
	});

	test("con la contraseña actual equivocada lo dice claro", async () => {
		const { client } = withFetch(
			() =>
				new Response(
					'{"code":"INVALID_PASSWORD","message":"Invalid password"}',
					{
						status: 400,
					},
				),
		);

		const result = await client.changePassword("mal", "nueva-12345");
		expect(result.ok).toBe(false);
		expect(result.error).toBe("wrong_current_password");
	});
});

describe("changeEmail (#532)", () => {
	test("pide el cambio con la vuelta a la pestaña de cuenta", async () => {
		const { client, calls } = withFetch(
			() => new Response("{}", { status: 200 }),
		);

		const result = await client.changeEmail("nuevo@ejemplo.test");

		expect(result.ok).toBe(true);
		expect(calls[0]?.url).toContain("/api/auth/change-email");
		expect(calls[0]?.body).toEqual({
			newEmail: "nuevo@ejemplo.test",
			callbackURL: "/perfil?tab=account",
		});
	});

	test("propaga el error del servidor", async () => {
		const { client } = withFetch(
			() => new Response('{"message":"Email is the same"}', { status: 400 }),
		);

		const result = await client.changeEmail("mismo@ejemplo.test");
		expect(result.ok).toBe(false);
		expect(result.error).toContain("same");
	});
});

describe("hasPasswordAccount (#532)", () => {
	test("una cuenta con credencial tiene contraseña", async () => {
		const { client } = withFetch(() =>
			Response.json([{ providerId: "credential" }]),
		);
		expect(await client.hasPasswordAccount()).toBe(true);
	});

	test("una cuenta solo de acceso institucional no la tiene", async () => {
		// La contraseña y el correo se gestionan en el proveedor de identidad.
		const { client } = withFetch(() => Response.json([{ providerId: "oidc" }]));
		expect(await client.hasPasswordAccount()).toBe(false);
	});

	test("con las dos, sí: puede cambiar la suya", async () => {
		const { client } = withFetch(() =>
			Response.json([{ providerId: "oidc" }, { providerId: "credential" }]),
		);
		expect(await client.hasPasswordAccount()).toBe(true);
	});

	test("si no se puede saber, no enseña los formularios", async () => {
		// Ofrecer cambiar una contraseña que no existe acaba en error.
		const { client } = withFetch(() => new Response("", { status: 500 }));
		expect(await client.hasPasswordAccount()).toBe(false);
	});
});
