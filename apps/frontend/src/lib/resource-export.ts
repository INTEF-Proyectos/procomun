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

export type DownloadMenuOption =
	| { kind: "direct"; id: "elpx"; label: "ELPX" }
	| { kind: "export"; id: ResourceExportKind; label: string };

const DOWNLOAD_MENU_EXPORT_LABELS: Record<ResourceExportKind, string> = {
	scorm: "SCORM",
	// La ficha muestra «LMS»; el id interno sigue siendo ims.
	ims: "LMS",
	web: "Web",
	epub: "EPUB",
};

/** Opciones del menú Descargar. «Ver online» no forma parte de esta lista. */
export function listDownloadMenuOptions(input: {
	hasDirectFile: boolean;
	hasExports: boolean;
}): DownloadMenuOption[] {
	const options: DownloadMenuOption[] = [];
	if (input.hasDirectFile) {
		options.push({ kind: "direct", id: "elpx", label: "ELPX" });
	}
	if (input.hasExports) {
		for (const option of RESOURCE_EXPORT_OPTIONS) {
			options.push({
				kind: "export",
				id: option.id,
				label: DOWNLOAD_MENU_EXPORT_LABELS[option.id],
			});
		}
	}
	return options;
}

export function isElpxFilename(filename?: string | null): boolean {
	if (!filename) return false;
	const normalized = filename.toLowerCase();
	return normalized.endsWith(".elpx") || normalized.endsWith(".elp");
}

export function getElpxMediaItem(
	mediaItems?: MediaItemRecord[] | null,
): MediaItemRecord | null {
	if (!mediaItems?.length) return null;
	return (
		mediaItems.find((mediaItem) => isElpxFilename(mediaItem.filename)) ?? null
	);
}

export function getResourceElpxFileUrl(
	resource: Pick<Resource, "elpxFileUrl" | "mediaItems">,
): string | null {
	if (resource.elpxFileUrl) return resource.elpxFileUrl;
	return getElpxMediaItem(resource.mediaItems)?.url ?? null;
}

export function buildExportFilename(
	title: string,
	format: ResourceExportKind,
): string {
	const slug =
		title
			.toLowerCase()
			.normalize("NFD")
			.replaceAll(/[\u0300-\u036f]/g, "")
			.replaceAll(/[^a-z0-9]+/g, "-")
			.replaceAll(/(^-|-$)/g, "") || "recurso";
	const suffixes: Record<ResourceExportKind, string> = {
		scorm: "_scorm.zip",
		ims: "_ims.zip",
		web: "_web.zip",
		epub: ".epub",
	};
	return `${slug}${suffixes[format]}`;
}
