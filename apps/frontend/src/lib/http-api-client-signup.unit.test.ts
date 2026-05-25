import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { HttpApiClient } from "./http-api-client.ts";

describe("HttpApiClient.signUp", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("calls /api/auth/sign-up/email with name, email and password", async () => {
		let capturedUrl = "";
		let capturedInit: RequestInit | undefined;

		globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
			capturedUrl = url as string;
			capturedInit = init;
			return new Response(JSON.stringify({ user: { id: "u1" } }), { status: 200 });
		}) as typeof fetch;

		const client = new HttpApiClient();
		const result = await client.signUp("Test User", "test@example.com", "password123");

		expect(result.ok).toBe(true);
		expect(capturedUrl).toBe("/api/auth/sign-up/email");
		expect(capturedInit?.method).toBe("POST");
		expect(capturedInit?.credentials).toBe("include");
		const body = JSON.parse(capturedInit?.body as string);
		expect(body.name).toBe("Test User");
		expect(body.email).toBe("test@example.com");
		expect(body.password).toBe("password123");
	});

	test("returns error when sign-up fails (e.g. email already exists)", async () => {
		globalThis.fetch = mock(async () => {
			return new Response(JSON.stringify({ message: "User already exists" }), { status: 422 });
		}) as typeof fetch;

		const client = new HttpApiClient();
		const result = await client.signUp("Test User", "existing@example.com", "password123");

		expect(result.ok).toBe(false);
		expect(result.error).toBe("User already exists");
	});

	test("returns default error message when response has no message", async () => {
		globalThis.fetch = mock(async () => {
			return new Response("", { status: 500 });
		}) as typeof fetch;

		const client = new HttpApiClient();
		const result = await client.signUp("Test User", "test@example.com", "password123");

		expect(result.ok).toBe(false);
		expect(result.error).toBe("Error al crear la cuenta");
	});
});
