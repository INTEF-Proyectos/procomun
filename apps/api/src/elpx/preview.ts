export type ElpxPreview = {
	hash: string;
	previewUrl: string;
	/** Miniatura screenshot.png de eXeLearning 4 (#409), si el paquete la trae. */
	screenshotUrl: string | null;
};

export function buildElpxPreview(
	elpx:
		| { hash?: string; hasPreview?: boolean; hasScreenshot?: boolean }
		| null
		| undefined,
): ElpxPreview | null {
	if (!elpx?.hasPreview || !elpx.hash) return null;
	const previewUrl = `/api/v1/elpx/${elpx.hash}/`;
	return {
		hash: elpx.hash,
		previewUrl,
		screenshotUrl: elpx.hasScreenshot ? `${previewUrl}screenshot.png` : null,
	};
}

export type ElpxRow = {
	resourceId: string;
	hash: string;
	hasPreview: boolean;
	hasScreenshot?: boolean;
};

export function buildElpxMap(rows: ElpxRow[]): Map<string, ElpxRow> {
	return new Map(rows.map((row) => [row.resourceId, row]));
}
