import { afterEach, describe, expect, mock, test } from "bun:test";
import { HttpApiClient } from "./http-api-client.ts";

describe("HttpApiClient: filtros del listado de colecciones (#612)", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		mock.restore();
		globalThis.fetch = originalFetch;
	});

	function capture() {
		const urls: string[] = [];
		globalThis.fetch = mock(async (url: string | URL | Request) => {
			urls.push(String(url));
			return new Response(JSON.stringify({ data: [], total: 0 }));
		}) as unknown as typeof fetch;
		return urls;
	}

	test("envía el texto y los filtros con los nombres del buscador", async () => {
		const urls = capture();
		await new HttpApiClient().listPublicCollections({
			q: "álgebra",
			limit: 9,
			offset: 9,
			language: "ca",
			tag: "funciones",
			knowledgeAreas: ["matematicas", "geografia"],
			educationalCategory: "educacion-primaria",
			educationalOption: "primer-ciclo",
		});
		const params = new URL(urls[0] ?? "", "http://localhost").searchParams;
		expect(Object.fromEntries(params)).toEqual({
			q: "álgebra",
			limit: "9",
			offset: "9",
			language: "ca",
			tag: "funciones",
			knowledgeAreas: "matematicas,geografia",
			educationalCategory: "educacion-primaria",
			educationalOption: "primer-ciclo",
		});
	});

	test("omite los filtros vacíos", async () => {
		const urls = capture();
		await new HttpApiClient().listPublicCollections({
			language: "",
			tag: "",
			knowledgeAreas: [],
		});
		expect(urls[0]).toBe("/api/v1/collections");
	});

	test("un error HTTP con cuerpo JSON rechaza en vez de resolver sin `data` (#629)", async () => {
		globalThis.fetch = mock(
			async () =>
				new Response(JSON.stringify({ error: "No disponible" }), {
					status: 503,
				}),
		) as unknown as typeof fetch;

		await expect(new HttpApiClient().listPublicCollections()).rejects.toEqual({
			error: "No disponible",
		});
	});
});
