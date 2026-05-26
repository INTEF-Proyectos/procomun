export function escapeHtml(s: string): string {
	return s
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

export const TYPE_ICONS: Record<string, string> = {
	documento: "📄", presentacion: "📊", video: "🎞️", audio: "🎧",
	imagen: "📷", "actividad-interactiva": "🎮", "secuencia-didactica": "📚",
	ejercicio: "✍️", evaluacion: "📋", proyecto: "🚀",
};

export const STATUS_MAP: Record<string, { label: string; cssClass: string }> = {
	draft: { label: "Borrador", cssClass: "pill-status-draft" },
	review: { label: "En revision", cssClass: "pill-status-review" },
	published: { label: "Publicado", cssClass: "pill-status-published" },
	archived: { label: "Archivado", cssClass: "pill-status-archived" },
};

export const FILE_ICONS: Record<string, string> = {
	"application/pdf": "📄", "video/mp4": "🎞️", "audio/mpeg": "🎧",
	"image/png": "📷", "image/jpeg": "📷", "image/gif": "📷",
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
