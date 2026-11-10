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

// Revisión de #552: un fallo de red se quedaba en una promesa rechazada y la
// pestaña no decía nada.
describe("fallos de red en la pestaña Cuenta (#552)", () => {
	function offline() {
		globalThis.fetch = (async () => {
			throw new TypeError("Failed to fetch");
		}) as unknown as typeof fetch;
	}

	test("changePassword devuelve ok: false en vez de lanzar", async () => {
		offline();
		expect(
			await new HttpApiClient().changePassword("actual-1234", "nueva-12345"),
		).toEqual({ ok: false });
	});

	test("changeEmail devuelve ok: false en vez de lanzar", async () => {
		offline();
		expect(await new HttpApiClient().changeEmail("nuevo@ejemplo.test")).toEqual(
			{ ok: false },
		);
	});
});

// Revisión de #552: con /perfil fijo, quien cambia el correo en inglés o con
// la app bajo un subdirectorio volvía a una ruta que no es la suya.
describe("changeEmail respeta el idioma (#552)", () => {
	test("la vuelta lleva el prefijo de idioma", async () => {
		const g = globalThis as { document?: unknown };
		const originalDocument = g.document;
		g.document = { documentElement: { lang: "en" } };
		try {
			const { client, calls } = withFetch(
				() => new Response("{}", { status: 200 }),
			);
			await client.changeEmail("nuevo@ejemplo.test");
			expect(calls[0]?.body).toMatchObject({
				callbackURL: "/en/perfil?tab=account",
			});
		} finally {
			g.document = originalDocument;
		}
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
