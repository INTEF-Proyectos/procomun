import { afterEach, describe, expect, mock, test } from "bun:test";
import { HttpApiClient } from "./http-api-client.ts";

describe("HttpApiClient: listado público de recursos (#624)", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		mock.restore();
		globalThis.fetch = originalFetch;
	});

	test("un error HTTP con cuerpo JSON rechaza en vez de resolver sin `data`", async () => {
		globalThis.fetch = mock(
			async () =>
				new Response(JSON.stringify({ error: "Fallo interno" }), {
					status: 500,
				}),
		) as unknown as typeof fetch;

		await expect(new HttpApiClient().listResources({ q: "x" })).rejects.toEqual(
			{ error: "Fallo interno" },
		);
	});
});
