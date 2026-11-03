import { afterEach, describe, expect, mock, test } from "bun:test";
import { HttpApiClient } from "./http-api-client.ts";

describe("HttpApiClient: áreas de conocimiento (#448)", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		mock.restore();
		globalThis.fetch = originalFetch;
	});

	function capture(response: Response) {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		globalThis.fetch = mock(
			async (url: string | URL | Request, init?: RequestInit) => {
				calls.push({ url: String(url), init });
				return response;
			},
		) as unknown as typeof fetch;
		return calls;
	}

	test("crea un área con la sesión", async () => {
		const calls = capture(
			new Response(JSON.stringify({ id: "cine", label: "Cine" }), {
				status: 201,
			}),
		);
		const area = await new HttpApiClient().createAdminKnowledgeArea({
			label: "Cine",
			blockId: "artes",
		});
		expect(area.id).toBe("cine");
		expect(calls[0]?.url).toBe("/api/admin/knowledge-areas");
		expect(calls[0]?.init?.method).toBe("POST");
		expect(calls[0]?.init?.credentials).toBe("include");
		expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
			label: "Cine",
			blockId: "artes",
		});
	});

	test("edita con PATCH y propaga el error del servidor", async () => {
		const calls = capture(
			new Response(
				JSON.stringify({ error: "Ya existe un área con esa denominación" }),
				{ status: 409 },
			),
		);
		await expect(
			new HttpApiClient().updateAdminKnowledgeArea("musica", {
				label: "Historia",
			}),
		).rejects.toEqual({ error: "Ya existe un área con esa denominación" });
		expect(calls[0]?.url).toBe("/api/admin/knowledge-areas/musica");
		expect(calls[0]?.init?.method).toBe("PATCH");
	});
});
