import { afterEach, describe, expect, mock, test } from "bun:test";
import { HttpApiClient } from "./http-api-client.ts";

const originalFetch = globalThis.fetch;

function stubFetch(response: Response): string[] {
	const calls: string[] = [];
	globalThis.fetch = mock(async (url: string | URL | Request) => {
		calls.push(String(url));
		return response;
	}) as unknown as typeof fetch;
	return calls;
}

describe("HttpApiClient.getPublicAuthor (#458)", () => {
	afterEach(() => {
		mock.restore();
		globalThis.fetch = originalFetch;
	});

	test("pide la ficha con el id codificado y la paginación", async () => {
		const body = {
			author: { id: "a:1", name: "Ana", image: null },
			data: [],
			total: 0,
			limit: 12,
			offset: 12,
		};
		const calls = stubFetch(Response.json(body));
		const result = await new HttpApiClient().getPublicAuthor("a:1", {
			limit: 12,
			offset: 12,
		});
		expect(calls).toEqual(["/api/v1/authors/a%3A1?limit=12&offset=12"]);
		expect(result).toEqual(body);
	});

	test("devuelve null si la ficha no existe", async () => {
		stubFetch(Response.json({ error: "Ficha no encontrada" }, { status: 404 }));
		expect(await new HttpApiClient().getPublicAuthor("x")).toBeNull();
	});

	test("lanza ante otros errores para poder avisar", async () => {
		stubFetch(Response.json({ error: "boom" }, { status: 500 }));
		await expect(new HttpApiClient().getPublicAuthor("x")).rejects.toBeTruthy();
	});
});
