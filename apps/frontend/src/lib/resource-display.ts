import { RESOURCE_TYPES } from "@procomun/db/resource-types";
import { url } from "./paths.ts";

export function escapeHtml(s: string): string {
	return s
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

export const TYPE_ICONS: Record<string, string> = {
	documento: "📄",
	presentacion: "📊",
	video: "🎞️",
	audio: "🎧",
	imagen: "📷",
	"actividad-interactiva": "🎮",
	"secuencia-didactica": "📚",
	ejercicio: "✍️",
	evaluacion: "📋",
	proyecto: "🚀",
};

export const STATUS_MAP = {
	draft: { label: "Borrador", cssClass: "pill-status-draft" },
	review: { label: "En revision", cssClass: "pill-status-review" },
	published: { label: "Publicado", cssClass: "pill-status-published" },
	archived: { label: "Archivado", cssClass: "pill-status-archived" },
} as const satisfies Record<string, { label: string; cssClass: string }>;

export type EditorialStatusKey = keyof typeof STATUS_MAP;

/** Resolve a dynamic editorial status string to its display metadata. */
export function statusLabelOf(status: string | undefined | null): {
	label: string;
	cssClass: string;
} {
	if (status != null && Object.hasOwn(STATUS_MAP, status)) {
		return STATUS_MAP[status as EditorialStatusKey];
	}
	return STATUS_MAP.draft;
}

export const FILE_ICONS: Record<string, string> = {
	"application/pdf": "📄",
	"video/mp4": "🎞️",
	"audio/mpeg": "🎧",
	"image/png": "📷",
	"image/jpeg": "📷",
	"image/gif": "📷",
};

export function formatBytes(bytes?: number | null): string {
	if (!bytes || bytes <= 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	let value = bytes;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/** Denominación legible del tipo de recurso («proyecto» → «Proyecto»). */
export function resourceTypeLabel(value: string): string {
	return RESOURCE_TYPES.find((type) => type.value === value)?.label ?? value;
}

const LANGUAGE_NAMES = new Intl.DisplayNames(["es"], { type: "language" });

/** Nombre del idioma a partir de su código («es» → «Español»). */
export function languageLabel(code: string): string {
	try {
		const name = LANGUAGE_NAMES.of(code) ?? code;
		return name.charAt(0).toLocaleUpperCase("es") + name.slice(1);
	} catch {
		return code;
	}
}

/** Búsqueda de texto con el valor completo como consulta (#459). */
export function searchHref(value: string): string {
	return url(`explorar?q=${encodeURIComponent(value)}`);
}
