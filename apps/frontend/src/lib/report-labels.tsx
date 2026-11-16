/**
 * Etiquetas de las denuncias de contenido, compartidas por el botón público
 * («Reportar») y la cola de moderación. Issue #539: se denuncian recursos y
 * colecciones con los mismos motivos.
 */
import "./paraglide-client.ts";
import * as m from "../paraglide/messages.js";

/** Los mismos valores que `REPORT_REASONS` en `@procomun/db`. */
export const REPORT_REASON_VALUES = [
	"inappropriate",
	"copyright",
	"incorrect_info",
	"broken_link",
	"spam",
	"other",
] as const;

export type ReportTarget = "resource" | "collection";

const REASON_LABELS: Record<string, () => string> = {
	inappropriate: m.report_reason_inappropriate,
	copyright: m.report_reason_copyright,
	incorrect_info: m.report_reason_incorrect_info,
	broken_link: m.report_reason_broken_link,
	spam: m.report_reason_spam,
	other: m.report_reason_other,
};

const STATUS_LABELS: Record<string, () => string> = {
	pending: m.admin_reports_status_pending,
	in_review: m.admin_reports_status_in_review,
	resolved: m.admin_reports_status_resolved,
	dismissed: m.admin_reports_status_dismissed,
};

export function reportReasonLabel(reason: string): string {
	return REASON_LABELS[reason]?.() ?? reason;
}

export function reportStatusLabel(status: string): string {
	return STATUS_LABELS[status]?.() ?? status;
}

export function reportTarget(report: {
	collectionId?: string | null;
	resourceId?: string | null;
}): ReportTarget {
	return report.collectionId ? "collection" : "resource";
}

/**
 * Acciones de resolución. Las de recurso solo para denuncias de recursos y las
 * de colección solo para las de colecciones, como valida la API.
 */
export function reportActionOptions(
	target: ReportTarget,
): Array<{ value: string; label: string }> {
	const specific =
		target === "collection"
			? [
					{
						value: "collection_edited",
						label: m.admin_reports_action_collection_edited(),
					},
					{
						value: "collection_deactivated",
						label: m.admin_reports_action_collection_deactivated(),
					},
					{
						value: "collection_deleted",
						label: m.admin_reports_action_collection_deleted(),
					},
				]
			: [
					{
						value: "resource_edited",
						label: m.admin_reports_action_resource_edited(),
					},
					{
						value: "resource_deactivated",
						label: m.admin_reports_action_resource_deactivated(),
					},
					{
						value: "resource_deleted",
						label: m.admin_reports_action_resource_deleted(),
					},
				];
	return [
		{ value: "", label: m.admin_reports_action_select() },
		{ value: "dismissed", label: m.admin_reports_action_dismissed() },
		{
			value: "resolved_no_change",
			label: m.admin_reports_action_resolved_no_change(),
		},
		...specific,
		{
			value: "referred_editorial",
			label: m.admin_reports_action_referred_editorial(),
		},
	];
}
