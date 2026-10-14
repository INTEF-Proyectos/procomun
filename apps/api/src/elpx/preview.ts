import { selectElpxCoverImage } from "@procomun/db/elpx-cover";

export function buildElpxPreview(
	elpx: { hash?: string; hasPreview?: boolean } | null | undefined,
	entryNames: readonly string[] = [],
): { hash: string; previewUrl: string; coverImageUrl: string | null } | null {
	if (!elpx?.hasPreview || !elpx.hash) return null;
	const previewUrl = `/api/v1/elpx/${elpx.hash}/`;
	const cover = selectElpxCoverImage(entryNames);
	return {
		hash: elpx.hash,
		previewUrl,
		coverImageUrl: cover ? `${previewUrl}${cover}` : null,
	};
}

export type ElpxRow = { resourceId: string; hash: string; hasPreview: boolean };

export function buildElpxMap(rows: ElpxRow[]): Map<string, ElpxRow> {
	return new Map(rows.map((row) => [row.resourceId, row]));
}
