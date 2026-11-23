import { useEffect, useState } from "react";
import type { ApiClient } from "../../lib/api-client.ts";
import { getApiClient } from "../../lib/get-api-client.ts";
import { RatingSummary } from "../../ui/RatingSummary.tsx";
import { StarRating } from "../../ui/StarRating.tsx";
import "./RatingIsland.css";

export interface RatingIslandProps {
	slug: string;
	target?: "resource" | "collection";
	currentUserId?: string | null;
}

const EMPTY_RATING = {
	averageScore: 0,
	totalRatings: 0,
	distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
};
type RatingData = typeof EMPTY_RATING & { userScore?: number | null };

function loadRating(
	api: ApiClient,
	target: "resource" | "collection",
	slug: string,
): Promise<RatingData> {
	return target === "collection"
		? api.getCollectionRatings(slug)
		: api.getResourceRatings(slug);
}

/**
 * Guarda el voto y recarga el resumen. Si la recarga falla, el voto ya está
 * guardado: se conserva el resumen anterior con la puntuación nueva en lugar
 * de mostrar un error.
 */
export async function rateAndRefresh(
	api: ApiClient,
	target: "resource" | "collection",
	slug: string,
	score: number,
	current: RatingData | null,
): Promise<RatingData> {
	const result =
		target === "collection"
			? await api.submitCollectionRating(slug, score)
			: await api.submitRating(slug, score);
	const saved = { ...(current ?? EMPTY_RATING), userScore: result.score };
	return loadRating(api, target, slug).catch(() => saved);
}

export function RatingIsland({
	slug,
	target = "resource",
	currentUserId,
}: RatingIslandProps) {
	const [rating, setRating] = useState<RatingData | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState("");
	const userScore = rating?.userScore ?? 0;
	const Heading = target === "collection" ? "h2" : "h3";

	useEffect(() => {
		let active = true;
		void getApiClient()
			.then((api) => loadRating(api, target, slug))
			.catch(() => EMPTY_RATING)
			.then((data) => {
				if (active) setRating(data);
			});
		return () => {
			active = false;
		};
	}, [slug, target]);

	async function handleRate(score: number) {
		if (!currentUserId || submitting) return;
		setSubmitting(true);
		setError("");
		try {
			const api = await getApiClient();
			setRating(await rateAndRefresh(api, target, slug, score, rating));
		} catch {
			setError("No se pudo actualizar la valoración. Inténtalo de nuevo.");
		} finally {
			setSubmitting(false);
		}
	}

	if (!rating) {
		return <p className="rating-loading">Cargando valoraciones...</p>;
	}

	return (
		<div className="rating-island">
			<Heading className="rating-island-title">Valoraciones</Heading>
			<RatingSummary rating={rating} />
			{currentUserId && (
				<div className="rating-island-user">
					<p className="rating-island-label">
						{userScore > 0
							? "Tu valoración:"
							: target === "collection"
								? "Valora esta colección:"
								: "Valora este recurso:"}
					</p>
					<StarRating value={userScore} onChange={handleRate} size="lg" />
					<span aria-live="polite">{error}</span>
				</div>
			)}
		</div>
	);
}
