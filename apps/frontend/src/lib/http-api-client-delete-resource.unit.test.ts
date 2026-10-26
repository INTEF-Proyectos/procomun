import { afterEach, describe, expect, mock, test } from "bun:test";
import { HttpApiClient } from "./http-api-client.ts";

describe("HttpApiClient.deleteResource (#393)", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		mock.restore();
		globalThis.fetch = originalFetch;
	});

	test("llama al DELETE de Administrar con la sesión", async () => {
		let capturedUrl = "";
		let capturedInit: RequestInit | undefined;
		globalThis.fetch = mock(
			async (url: string | URL | Request, init?: RequestInit) => {
				capturedUrl = String(url);
				capturedInit = init;
				return new Response(null, { status: 204 });
			},
		) as unknown as typeof fetch;

		await new HttpApiClient().deleteResource("res-1");

		expect(capturedUrl).toBe("/api/admin/resources/res-1");
		expect(capturedInit?.method).toBe("DELETE");
		expect(capturedInit?.credentials).toBe("include");
	});

	test("falla si el servidor rechaza el borrado", async () => {
		globalThis.fetch = mock(
			async () =>
				new Response(JSON.stringify({ error: "Forbidden" }), {
					status: 403,
					headers: { "Content-Type": "application/json" },
				}),
		) as unknown as typeof fetch;

		await expect(new HttpApiClient().deleteResource("res-1")).rejects.toThrow(
			"Forbidden",
		);
	});
});
