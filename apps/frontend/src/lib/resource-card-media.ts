export type ResourceCardMedia =
	| { kind: "image"; url: string }
	| { kind: "preview"; url: string }
	| { kind: "empty" };

function safeImageUrl(value: string | null | undefined): string | null {
	const url = value?.trim();
	if (!url) return null;
	if (url.startsWith("/") && !url.startsWith("//")) return url;
	try {
		const parsed = new URL(url);
		if (parsed.protocol === "https:" || parsed.protocol === "http:") return url;
	} catch {
		return null;
	}
	return null;
}

/** La miniatura de metadatos manda sobre el iframe del .elpx. */
export function resourceCardMedia(resource: {
	thumbnailUrl?: string | null;
	elpxPreview?: { previewUrl?: string | null } | null;
}): ResourceCardMedia {
	const image = safeImageUrl(resource.thumbnailUrl);
	if (image) return { kind: "image", url: image };
	const preview = safeImageUrl(resource.elpxPreview?.previewUrl);
	if (preview) return { kind: "preview", url: preview };
	return { kind: "empty" };
}
