import { afterEach, describe, expect, mock, test } from "bun:test";
import { HttpApiClient } from "./http-api-client.ts";

const originalFetch = globalThis.fetch;

function mockFetch(responses: Response[]): string[] {
	const urls: string[] = [];
	globalThis.fetch = mock(async (url: string | URL | Request) => {
		urls.push(String(url));
		const response = responses.shift();
		if (!response) throw new Error(`Unexpected fetch call: ${String(url)}`);
		return response;
	}) as unknown as typeof fetch;
	return urls;
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("HttpApiClient: valoraciones (#609)", () => {
	afterEach(() => {
		mock.restore();
		globalThis.fetch = originalFetch;
	});

	test("las colecciones codifican el slug al leer y al votar", async () => {
		const urls = mockFetch([
			json({ averageScore: 4, totalRatings: 1, userScore: 4 }),
			json({ score: 3 }),
		]);
		const client = new HttpApiClient();

		await expect(client.getCollectionRatings("a b")).resolves.toMatchObject({
			averageScore: 4,
		});
		await expect(client.submitCollectionRating("a b", 3)).resolves.toEqual({
			score: 3,
		});
		expect(urls).toEqual([
			"/api/v1/collections/a%20b/ratings",
			"/api/v1/collections/a%20b/ratings",
		]);
	});

	test("un error al leer el resumen se lanza en lugar de devolverse como datos", async () => {
		mockFetch([
			json({ error: "Recurso no encontrado" }, 404),
			json({ error: "Colección no encontrada" }, 404),
		]);
		const client = new HttpApiClient();

		await expect(client.getResourceRatings("x")).rejects.toThrow();
		await expect(client.getCollectionRatings("x")).rejects.toThrow();
	});

	test("un voto rechazado propaga el cuerpo del error", async () => {
		mockFetch([json({ error: "No autenticado" }, 401)]);
		const client = new HttpApiClient();

		await expect(client.submitCollectionRating("x", 5)).rejects.toEqual({
			error: "No autenticado",
		});
	});
});
