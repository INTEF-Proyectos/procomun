import { afterEach, describe, expect, mock, test } from "bun:test";
import { HttpApiClient } from "./http-api-client.ts";

describe("HttpApiClient.listMyResources (#530)", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		mock.restore();
		globalThis.fetch = originalFetch;
	});

	test("pide los recursos propios con estado, texto, filtros y la sesión", async () => {
		let capturedUrl = "";
		let capturedInit: RequestInit | undefined;
		const payload = {
			data: [],
			total: 0,
			limit: 12,
			offset: 24,
			statusCounts: {
				draft: 0,
				review: 0,
				published: 0,
				archived: 0,
				total: 0,
			},
		};
		globalThis.fetch = mock(
			async (url: string | URL | Request, init?: RequestInit) => {
				capturedUrl = String(url);
				capturedInit = init;
				return Response.json(payload);
			},
		) as unknown as typeof fetch;

		const result = await new HttpApiClient().listMyResources({
			status: "review",
			q: "fracciones",
			limit: 12,
			offset: 24,
			resourceType: "video",
			tag: "geometria",
			educationalCategory: "fp",
			knowledgeAreas: ["matematicas", "fisica"],
			professionalFamilies: ["informatica"],
		});

		const parsed = new URL(capturedUrl, "http://localhost");
		expect(parsed.pathname).toBe("/api/v1/users/me/resources");
		expect(Object.fromEntries(parsed.searchParams)).toEqual({
			status: "review",
			q: "fracciones",
			limit: "12",
			offset: "24",
			resourceType: "video",
			tag: "geometria",
			educationalCategory: "fp",
			knowledgeAreas: "matematicas,fisica",
			professionalFamilies: "informatica",
		});
		expect(capturedInit?.credentials).toBe("include");
		expect(result).toEqual(payload);
	});

	test("sin filtros no añade parámetros vacíos", async () => {
		let capturedUrl = "";
		globalThis.fetch = mock(async (url: string | URL | Request) => {
			capturedUrl = String(url);
			return Response.json({ data: [], total: 0, limit: 20, offset: 0 });
		}) as unknown as typeof fetch;

		await new HttpApiClient().listMyResources({
			status: "",
			knowledgeAreas: [],
		});

		expect(capturedUrl).toBe("/api/v1/users/me/resources");
	});

	test("falla si el servidor responde con error", async () => {
		globalThis.fetch = mock(async () =>
			Response.json({ error: "Estado no válido" }, { status: 400 }),
		) as unknown as typeof fetch;

		await expect(
			new HttpApiClient().listMyResources({ status: "borrado" }),
		).rejects.toThrow("Estado no válido");
	});
});
