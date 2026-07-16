import { useEffect, useState } from "react";
import type { ReportRecord } from "../../lib/api-client.ts";
import { getApiClient } from "../../lib/get-api-client.ts";
import { AdminTable, type Column } from "./AdminTable.tsx";

const PAGE_SIZE = 10;

const STATUS_MAP: Record<string, { label: string; className: string }> = {
	pending: { label: "Pendiente", className: "status-draft" },
	in_review: { label: "En revision", className: "status-review" },
	resolved: { label: "Resuelto", className: "status-published" },
	dismissed: { label: "Descartado", className: "status-archived" },
};

const REASON_LABELS: Record<string, string> = {
	inappropriate: "Inapropiado",
	copyright: "Derechos de autor",
	incorrect_info: "Info incorrecta",
	broken_link: "Enlace roto",
	spam: "Spam",
	other: "Otro",
};

const STATUS_FILTERS = [
	{ value: "", label: "Todos" },
	{ value: "pending", label: "Pendiente" },
	{ value: "in_review", label: "En revision" },
	{ value: "resolved", label: "Resuelto" },
	{ value: "dismissed", label: "Descartado" },
];

const ACTION_OPTIONS = [
	{ value: "", label: "Seleccionar accion" },
	{ value: "dismissed", label: "Descartar (sin accion)" },
	{ value: "resolved_no_change", label: "Resolver sin cambios" },
	{ value: "resource_edited", label: "Recurso editado" },
	{ value: "resource_deactivated", label: "Desactivar recurso" },
	{ value: "resource_deleted", label: "Eliminar recurso" },
	{ value: "referred_editorial", label: "Derivar a editorial" },
];

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

	async function loadReports(p: number, status: string) {
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
	}

	useEffect(() => {
		void loadReports(1, statusFilter);
	}, []);

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
			key: "resource",
			label: "Recurso",
			render: (r) => (
				<div>
					<strong>{r.resourceTitle || "Sin titulo"}</strong>
				</div>
			),
		},
		{
			key: "reason",
			label: "Motivo",
			render: (r) => REASON_LABELS[r.reason] || r.reason,
		},
		{
			key: "status",
			label: "Estado",
			render: (r) => {
				const s = STATUS_MAP[r.status] || { label: r.status, className: "" };
				return (
					<span className={`admin-status-badge ${s.className}`}>{s.label}</span>
				);
			},
		},
		{
			key: "date",
			label: "Fecha",
			render: (r) => formatDate(r.createdAt),
		},
		{
			key: "actions",
			label: "Acciones",
			render: (r) => (
				<div style={{ display: "flex", gap: "0.5rem" }}>
					{r.status === "pending" && (
						<button
							type="button"
							className="admin-btn admin-btn--sm"
							onClick={() => handleMarkInReview(r)}
						>
							Revisar
						</button>
					)}
					{(r.status === "pending" || r.status === "in_review") && (
						<button
							type="button"
							className="admin-btn admin-btn--sm admin-btn--danger"
							onClick={() => setSelectedReport(r)}
						>
							Resolver
						</button>
					)}
				</div>
			),
		},
	];

	return (
		<>
			<div className="admin-section-header">
				<h2>Denuncias de contenido</h2>
				<div className="admin-filters">
					<div className="admin-filter-group">
						{STATUS_FILTERS.map((f) => (
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
				emptyMessage="No hay denuncias para los filtros actuales."
			/>

			{/* Resolve modal */}
			{selectedReport && (
				<div
					className="admin-modal-overlay"
					onMouseDown={(e) => {
						if (e.target === e.currentTarget) setSelectedReport(null);
					}}
				>
					<div
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
								Resolver denuncia
							</h2>
							<p style={{ marginBottom: "0.5rem" }}>
								<strong>Recurso:</strong> {selectedReport.resourceTitle}
							</p>
							<p style={{ marginBottom: "1rem" }}>
								<strong>Motivo:</strong>{" "}
								{REASON_LABELS[selectedReport.reason] || selectedReport.reason}
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
									Accion a tomar *
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
									{ACTION_OPTIONS.map((o) => (
										<option key={o.value} value={o.value}>
											{o.label}
										</option>
									))}
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
									Notas de resolucion (opcional)
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
									placeholder="Describe la resolucion..."
								/>
							</div>

							<div className="admin-dialog-actions">
								<button
									type="button"
									className="admin-btn"
									onClick={() => setSelectedReport(null)}
									disabled={busy}
								>
									Cancelar
								</button>
								<button
									type="submit"
									className="admin-btn admin-btn--danger"
									disabled={busy || !actionTaken}
								>
									{busy ? "Procesando..." : "Confirmar resolucion"}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}
		</>
	);
}
