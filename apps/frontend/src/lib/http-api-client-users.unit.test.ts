import { afterEach, describe, expect, mock, test } from "bun:test";
import { HttpApiClient } from "./http-api-client.ts";

type FetchCall = { url: string; init?: RequestInit };

function captureFetch(response: Response): { calls: FetchCall[] } {
	const calls: FetchCall[] = [];
	globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(url), init });
		return response;
	}) as typeof fetch;
	return { calls };
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("HttpApiClient.createUser (DEF-019)", () => {
	const originalFetch = globalThis.fetch;
	afterEach(() => {
		mock.restore();
		globalThis.fetch = originalFetch;
	});

	test("crea el usuario contra /api/admin/users SIN usar el registro público", async () => {
		const { calls } = captureFetch(jsonResponse({ id: "u-new", created: true }, 201));
		const client = new HttpApiClient();

		const result = await client.createUser({ name: "Nueva", email: "nueva@test.com", password: "supersecret8", role: "editor" });

		expect(result).toEqual({ ok: true, id: "u-new" });
		expect(calls).toHaveLength(1);
		// Regresión DEF-019: jamás debe llamar al endpoint público de Better Auth.
		expect(calls[0].url).toBe("/api/admin/users");
		expect(calls[0].url).not.toContain("/api/auth/sign-up");
		expect(calls[0].init?.method).toBe("POST");
		expect(calls[0].init?.credentials).toBe("include");
		expect(JSON.parse(calls[0].init?.body as string)).toEqual({
			name: "Nueva",
			email: "nueva@test.com",
			password: "supersecret8",
			role: "editor",
		});
	});

	test("propaga errores de validación", async () => {
		captureFetch(jsonResponse({ error: "Datos inválidos", details: [{ field: "email", message: "Correo electrónico inválido" }] }, 400));
		const client = new HttpApiClient();

		const result = await client.createUser({ email: "malo", password: "x" });
		expect(result.ok).toBe(false);
		expect(result.error).toBe("Datos inválidos");
		expect(result.details?.[0]?.field).toBe("email");
	});
});

describe("HttpApiClient.updateUser (DEF-004)", () => {
	const originalFetch = globalThis.fetch;
	afterEach(() => {
		mock.restore();
		globalThis.fetch = originalFetch;
	});

	test("envía nombre y bio en el PATCH a /api/admin/users/:id", async () => {
		const { calls } = captureFetch(jsonResponse({ id: "u-1", updated: true }));
		const client = new HttpApiClient();

		const result = await client.updateUser("u-1", { name: "Nuevo Nombre", bio: "Mi nueva bio" });

		expect(result).toEqual({ ok: true });
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe("/api/admin/users/u-1");
		expect(calls[0].init?.method).toBe("PATCH");
		expect(calls[0].init?.credentials).toBe("include");
		// Regresión DEF-004: la bio debe viajar en el cuerpo del PATCH.
		const body = JSON.parse(calls[0].init?.body as string);
		expect(body.name).toBe("Nuevo Nombre");
		expect(body.bio).toBe("Mi nueva bio");
	});
});

describe("HttpApiClient.deleteUser (DEF-020)", () => {
	const originalFetch = globalThis.fetch;
	afterEach(() => {
		mock.restore();
		globalThis.fetch = originalFetch;
	});

	test("elimina contra /api/admin/users/:id", async () => {
		const { calls } = captureFetch(jsonResponse({ id: "u-1", deleted: true }));
		const client = new HttpApiClient();

		const result = await client.deleteUser("u-1");

		expect(result).toEqual({ ok: true });
		expect(calls[0].url).toBe("/api/admin/users/u-1");
		expect(calls[0].init?.method).toBe("DELETE");
		expect(calls[0].init?.credentials).toBe("include");
	});

	test("devuelve error cuando la baja falla", async () => {
		captureFetch(jsonResponse({ error: "Usuario no encontrado" }, 404));
		const client = new HttpApiClient();

		const result = await client.deleteUser("missing");
		expect(result).toEqual({ ok: false, error: "Usuario no encontrado" });
	});
});
