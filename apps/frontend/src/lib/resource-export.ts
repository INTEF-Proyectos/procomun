import type { MediaItemRecord, Resource } from "./api-client.ts";

export type ResourceExportKind = "web" | "scorm" | "ims" | "epub";

export interface ResourceExportOption {
	id: ResourceExportKind;
	label: string;
	editorFormat: string;
}

export const RESOURCE_EXPORT_OPTIONS: ResourceExportOption[] = [
	{ id: "scorm", label: "SCORM", editorFormat: "scorm12" },
	{ id: "ims", label: "IMS", editorFormat: "ims" },
	{ id: "web", label: "Web", editorFormat: "html5" },
	{ id: "epub", label: "EPUB", editorFormat: "epub3" },
];

export function isElpxFilename(filename?: string | null): boolean {
	if (!filename) return false;
	const normalized = filename.toLowerCase();
	return normalized.endsWith(".elpx") || normalized.endsWith(".elp");
}

export function getElpxMediaItem(mediaItems?: MediaItemRecord[] | null): MediaItemRecord | null {
	if (!mediaItems?.length) return null;
	return mediaItems.find((mediaItem) => isElpxFilename(mediaItem.filename)) ?? null;
}

export function getResourceElpxFileUrl(
	resource: Pick<Resource, "elpxFileUrl" | "mediaItems">,
): string | null {
	if (resource.elpxFileUrl) return resource.elpxFileUrl;
	return getElpxMediaItem(resource.mediaItems)?.url ?? null;
}
