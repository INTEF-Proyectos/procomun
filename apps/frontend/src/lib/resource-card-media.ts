import { TYPE_ICONS } from "./resource-display.ts";

export type ResourceCardMedia =
	| { kind: "image"; url: string }
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
 * Medio de la tarjeta: la miniatura screenshot.png de eXe 4 (#409), después
 * la imagen de metadatos (preview legacy), después la miniatura generada en
 * el servidor (#470) y, sin nada, el marcador del tipo de recurso. Ningún
 * listado carga el paquete en un iframe (#470, ADR-0046).
 */
export function resourceCardMedia(resource: {
	thumbnailUrl?: string | null;
	resourceType?: string | null;
	elpxPreview?: {
		screenshotUrl?: string | null;
		thumbnailUrl?: string | null;
	} | null;
}): ResourceCardMedia {
	const url =
		safeImageUrl(resource.elpxPreview?.screenshotUrl) ??
		safeImageUrl(resource.thumbnailUrl) ??
		safeImageUrl(resource.elpxPreview?.thumbnailUrl);
	if (url) return { kind: "image", url };
	const type = resource.resourceType ?? "";
	return {
		kind: "empty",
		icon: Object.hasOwn(TYPE_ICONS, type) ? (TYPE_ICONS[type] ?? null) : null,
	};
}
