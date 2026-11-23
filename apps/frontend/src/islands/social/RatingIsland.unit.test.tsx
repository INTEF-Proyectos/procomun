import { describe, expect, mock, test } from "bun:test";
import type { ApiClient } from "../../lib/api-client.ts";
import { rateAndRefresh } from "./RatingIsland.tsx";

const summary = {
	averageScore: 3,
	totalRatings: 2,
	distribution: { 1: 0, 2: 0, 3: 2, 4: 0, 5: 0 },
	userScore: null,
};

function fakeApi(overrides: Partial<ApiClient>): ApiClient {
	return overrides as ApiClient;
}

describe("rateAndRefresh (#609)", () => {
	test("vota la colección y devuelve el resumen recargado", async () => {
		const api = fakeApi({
			submitCollectionRating: mock(async () => ({ score: 5 })),
			getCollectionRatings: mock(async () => ({
				...summary,
				averageScore: 4,
				userScore: 5,
				collectionId: "c1",
			})),
		});

		const result = await rateAndRefresh(api, "collection", "col", 5, summary);

		expect(api.submitCollectionRating).toHaveBeenCalledWith("col", 5);
		expect(result).toMatchObject({ averageScore: 4, userScore: 5 });
	});

	test("si falla la recarga, conserva el voto guardado sin lanzar error", async () => {
		const api = fakeApi({
			submitRating: mock(async () => ({
				id: "r1",
				resourceId: "res",
				userId: "u1",
				score: 4,
				createdAt: "",
			})),
			getResourceRatings: mock(async () => {
				throw new Error("red caída");
			}),
		});

		await expect(
			rateAndRefresh(api, "resource", "res", 4, summary),
		).resolves.toEqual({ ...summary, userScore: 4 });
	});

	test("si falla el voto, el error se propaga", async () => {
		const api = fakeApi({
			submitCollectionRating: mock(async () => {
				throw { error: "No autenticado" };
			}),
		});

		await expect(
			rateAndRefresh(api, "collection", "col", 2, summary),
		).rejects.toEqual({ error: "No autenticado" });
	});
});
