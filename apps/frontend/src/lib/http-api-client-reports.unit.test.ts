import { afterEach, describe, expect, mock, test } from "bun:test";
import { HttpApiClient } from "./http-api-client.ts";

const originalFetch = globalThis.fetch;

type Call = { url: string; init?: RequestInit };

function stubFetch(response: Response): Call[] {
	const calls: Call[] = [];
	globalThis.fetch = mock(
		async (url: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(url), init });
			return response;
		},
	) as unknown as typeof fetch;
	return calls;
}

describe("HttpApiClient: denuncias de colecciones (#539)", () => {
	afterEach(() => {
		mock.restore();
		globalThis.fetch = originalFetch;
	});

	test("reportCollection envía el motivo a la colección con la sesión", async () => {
		const calls = stubFetch(Response.json({ id: "rep-1" }, { status: 201 }));
		const result = await new HttpApiClient().reportCollection(
			"mi-coleccion",
			"spam",
			"Detalle",
		);
		expect(result).toEqual({ id: "rep-1" });
		expect(calls[0]?.url).toBe("/api/v1/collections/mi-coleccion/report");
		expect(calls[0]?.init?.method).toBe("POST");
		expect(calls[0]?.init?.credentials).toBe("include");
		expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
			reason: "spam",
			description: "Detalle",
		});
	});

	test("reportCollection lanza con el error de la API", async () => {
		stubFetch(
			Response.json({ error: "Colección no encontrada" }, { status: 404 }),
		);
		await expect(
			new HttpApiClient().reportCollection("x", "spam"),
		).rejects.toThrow("Colección no encontrada");
	});

	test("listReports filtra por colección", async () => {
		const calls = stubFetch(
			Response.json({ data: [], total: 0, limit: 10, offset: 0 }),
		);
		await new HttpApiClient().listReports({ collectionId: "col-1" });
		expect(calls[0]?.url).toBe("/api/admin/reports?collectionId=col-1");
	});
});
