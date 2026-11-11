import { TYPE_ICONS } from "./resource-display.ts";

export type ResourceCardMedia =
	| { kind: "image"; url: string }
	| { kind: "preview"; url: string }
	/** Marcador del tipo de recurso; `null` usa el genérico. Es decorativo. */
	| { kind: "empty"; icon: string | null };

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

/**
 * Medio de la tarjeta (#409): la miniatura screenshot.png de eXe 4, después
 * la imagen de metadatos (preview legacy), después el iframe del .elpx como
 * reserva (#426) y, sin nada, el marcador del tipo de recurso. La miniatura no
 * depende del visor: con screenshot.png y sin index.html, `previewUrl` es null
 * y la tarjeta pinta la imagen sin iframe (#471).
 */
export function resourceCardMedia(resource: {
	thumbnailUrl?: string | null;
	resourceType?: string | null;
	elpxPreview?: {
		previewUrl?: string | null;
		screenshotUrl?: string | null;
	} | null;
}): ResourceCardMedia {
	const screenshot = safeImageUrl(resource.elpxPreview?.screenshotUrl);
	if (screenshot) return { kind: "image", url: screenshot };
	const image = safeImageUrl(resource.thumbnailUrl);
	if (image) return { kind: "image", url: image };
	const preview = safeImageUrl(resource.elpxPreview?.previewUrl);
	if (preview) return { kind: "preview", url: preview };
	const type = resource.resourceType ?? "";
	return {
		kind: "empty",
		icon: Object.hasOwn(TYPE_ICONS, type) ? (TYPE_ICONS[type] ?? null) : null,
	};
}
