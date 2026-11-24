import { useCallback, useEffect, useRef, useState } from "react";
import type { ReportRecord } from "../../lib/api-client.ts";
import { getApiClient } from "../../lib/get-api-client.ts";
import "../../lib/paraglide-client.ts";
import { url } from "../../lib/paths.ts";
import {
	reportActionOptions,
	reportReasonLabel,
	reportStatusLabel,
	reportTarget,
} from "../../lib/report-labels.tsx";
import * as m from "../../paraglide/messages.js";
import { AdminTable, type Column } from "./AdminTable.tsx";

const PAGE_SIZE = 10;

const STATUS_CLASS: Record<string, string> = {
	pending: "status-draft",
	in_review: "status-review",
	resolved: "status-published",
	dismissed: "status-archived",
};

function statusFilters() {
	return [
		{ value: "", label: m.admin_reports_filter_all() },
		{ value: "pending", label: reportStatusLabel("pending") },
		{ value: "in_review", label: reportStatusLabel("in_review") },
		{ value: "resolved", label: reportStatusLabel("resolved") },
		{ value: "dismissed", label: reportStatusLabel("dismissed") },
	];
}

/**
 * Lo denunciado: un recurso o, desde #539, una colección. Dice cuál de los dos
 * es y enlaza a su ficha pública.
 */
export function ReportTargetCell({ report }: { report: ReportRecord }) {
	const isCollection = reportTarget(report) === "collection";
	const title = isCollection ? report.collectionTitle : report.resourceTitle;
	const slug = isCollection ? report.collectionSlug : report.resourceSlug;
	// La ficha pública de una colección solo existe si está publicada (#585).
	const hasPublicPage =
		!isCollection || report.collectionStatus === "published";
	const href =
		slug && hasPublicPage
			? url(isCollection ? `colecciones?slug=${slug}` : `recurso?slug=${slug}`)
			: null;
	return (
		<div>
			<span className="admin-status-badge">
				{isCollection
					? m.admin_reports_kind_collection()
					: m.admin_reports_kind_resource()}
			</span>{" "}
			{href ? (
				<a href={href}>
					<strong>{title || m.admin_reports_untitled()}</strong>
				</a>
			) : (
				<strong>{title || m.admin_reports_untitled()}</strong>
			)}
		</div>
	);
}

function formatDate(d: string | null | undefined): string {
	if (!d) return "-";
	return new Date(d).toLocaleDateString("es-ES", {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

export function AdminReportsSection() {
	const [reports, setReports] = useState<ReportRecord[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [statusFilter, setStatusFilter] = useState("");
	const [loading, setLoading] = useState(true);
	const [selectedReport, setSelectedReport] = useState<ReportRecord | null>(
		null,
	);
	const [resolution, setResolution] = useState("");
	const [actionTaken, setActionTaken] = useState("");
	const [busy, setBusy] = useState(false);

	const loadReports = useCallback(async (p: number, status: string) => {
		setLoading(true);
		try {
			const api = await getApiClient();
			const result = await api.listReports({
				limit: PAGE_SIZE,
				offset: (p - 1) * PAGE_SIZE,
				status: status || undefined,
			});
			setReports(result.data);
			setTotal(result.total);
			setPage(p);
		} catch {
			setReports([]);
			setTotal(0);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		// statusFilter arranca en "" (valor inicial); la carga de montaje usa ese literal
		void loadReports(1, "");
	}, [loadReports]);

	const resolveDialogRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!selectedReport) return;
		function handleMouseDown(e: MouseEvent) {
			if (
				resolveDialogRef.current &&
				!resolveDialogRef.current.contains(e.target as Node)
			) {
				setSelectedReport(null);
			}
		}
		document.addEventListener("mousedown", handleMouseDown);
		return () => document.removeEventListener("mousedown", handleMouseDown);
	}, [selectedReport]);

	function handleStatusFilterChange(value: string) {
		setStatusFilter(value);
		void loadReports(1, value);
	}

	async function handleResolve() {
		if (!selectedReport || !actionTaken) return;
		setBusy(true);
		try {
			const api = await getApiClient();
			const newStatus = actionTaken === "dismissed" ? "dismissed" : "resolved";
			await api.updateReport(selectedReport.id, {
				status: newStatus,
				resolution: resolution || undefined,
				actionTaken,
			});
			setSelectedReport(null);
			setResolution("");
			setActionTaken("");
			void loadReports(page, statusFilter);
		} catch {
			// silently fail
		} finally {
			setBusy(false);
		}
	}

	async function handleMarkInReview(report: ReportRecord) {
		try {
			const api = await getApiClient();
			await api.updateReport(report.id, { status: "in_review" });
			void loadReports(page, statusFilter);
		} catch {
			// silently fail
		}
	}

	const columns: Column<ReportRecord>[] = [
		{
			key: "content",
			label: m.admin_reports_col_content(),
			render: (r) => <ReportTargetCell report={r} />,
		},
		{
			key: "reason",
			label: m.admin_reports_col_reason(),
			render: (r) => reportReasonLabel(r.reason),
		},
		{
			key: "status",
			label: m.admin_reports_col_status(),
			render: (r) => (
				<span className={`admin-status-badge ${STATUS_CLASS[r.status] ?? ""}`}>
					{reportStatusLabel(r.status)}
				</span>
			),
		},
		{
			key: "date",
			label: m.admin_reports_col_date(),
			render: (r) => formatDate(r.createdAt),
		},
		{
			key: "actions",
			label: m.admin_reports_col_actions(),
			render: (r) => (
				<div style={{ display: "flex", gap: "0.5rem" }}>
					{r.status === "pending" && (
						<button
							type="button"
							className="admin-btn admin-btn--sm"
							onClick={() => handleMarkInReview(r)}
						>
							{m.admin_reports_review()}
						</button>
					)}
					{(r.status === "pending" || r.status === "in_review") && (
						<button
							type="button"
							className="admin-btn admin-btn--sm admin-btn--danger"
							onClick={() => {
								// Las acciones dependen de si es un recurso o una colección.
								setActionTaken("");
								setSelectedReport(r);
							}}
						>
							{m.admin_reports_resolve()}
						</button>
					)}
				</div>
			),
		},
	];

	return (
		<>
			<div className="admin-section-header">
				<h2>{m.admin_reports_title()}</h2>
				<div className="admin-filters">
					<div className="admin-filter-group">
						{statusFilters().map((f) => (
							<button
								key={f.value}
								type="button"
								className={`admin-filter-btn${statusFilter === f.value ? " admin-filter-btn--active" : ""}`}
								onClick={() => handleStatusFilterChange(f.value)}
							>
								{f.label}
							</button>
						))}
					</div>
				</div>
			</div>

			<AdminTable<ReportRecord>
				columns={columns}
				data={reports}
				getKey={(r) => r.id}
				loading={loading}
				total={total}
				page={page}
				pageSize={PAGE_SIZE}
				onPageChange={(p) => void loadReports(p, statusFilter)}
				emptyMessage={m.admin_reports_empty()}
			/>

			{/* Resolve modal */}
			{selectedReport && (
				<div className="admin-modal-overlay">
					<div
						ref={resolveDialogRef}
						className="admin-confirm-dialog"
						role="dialog"
						aria-modal="true"
						aria-labelledby="resolve-report-title"
					>
						<form
							onSubmit={(e) => {
								e.preventDefault();
								void handleResolve();
							}}
						>
							<h2
								id="resolve-report-title"
								style={{ margin: "0 0 1rem", fontSize: "1.25rem" }}
							>
								{m.admin_reports_resolve_title()}
							</h2>
							<div style={{ marginBottom: "0.5rem" }}>
								<ReportTargetCell report={selectedReport} />
							</div>
							<p style={{ marginBottom: "1rem" }}>
								<strong>{m.admin_reports_col_reason()}:</strong>{" "}
								{reportReasonLabel(selectedReport.reason)}
								{selectedReport.description && (
									<span
										style={{
											display: "block",
											marginTop: "0.25rem",
											color: "var(--color-on-surface-variant)",
										}}
									>
										{selectedReport.description}
									</span>
								)}
							</p>

							<div style={{ marginBottom: "1rem" }}>
								<label
									htmlFor="resolve-action"
									style={{
										display: "block",
										marginBottom: "0.5rem",
										fontWeight: 500,
									}}
								>
									{m.admin_reports_action_label()} *
								</label>
								<select
									id="resolve-action"
									value={actionTaken}
									onChange={(e) => setActionTaken(e.target.value)}
									required
									style={{
										width: "100%",
										padding: "0.5rem",
										borderRadius: "6px",
										border: "1px solid var(--color-outline)",
									}}
								>
									{reportActionOptions(reportTarget(selectedReport)).map(
										(o) => (
											<option key={o.value} value={o.value}>
												{o.label}
											</option>
										),
									)}
								</select>
							</div>

							<div style={{ marginBottom: "1rem" }}>
								<label
									htmlFor="resolve-resolution"
									style={{
										display: "block",
										marginBottom: "0.5rem",
										fontWeight: 500,
									}}
								>
									{m.admin_reports_resolution_label()}
								</label>
								<textarea
									id="resolve-resolution"
									value={resolution}
									onChange={(e) => setResolution(e.target.value)}
									rows={3}
									style={{
										width: "100%",
										padding: "0.5rem",
										borderRadius: "6px",
										border: "1px solid var(--color-outline)",
										resize: "vertical",
									}}
									placeholder={m.admin_reports_resolution_placeholder()}
								/>
							</div>

							<div className="admin-dialog-actions">
								<button
									type="button"
									className="admin-btn"
									onClick={() => setSelectedReport(null)}
									disabled={busy}
								>
									{m.report_cancel()}
								</button>
								<button
									type="submit"
									className="admin-btn admin-btn--danger"
									disabled={busy || !actionTaken}
								>
									{busy
										? m.admin_reports_processing()
										: m.admin_reports_confirm()}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}
		</>
	);
}
