import { useState } from "react";
import { getApiClient } from "../../lib/get-api-client.ts";
import { url } from "../../lib/paths.ts";
import { ModalFrame } from "../shared/ModalFrame.tsx";

const REPORT_REASONS = [
	{ value: "inappropriate", label: "Contenido inapropiado" },
	{ value: "copyright", label: "Infraccion de derechos de autor" },
	{ value: "incorrect_info", label: "Informacion incorrecta" },
	{ value: "broken_link", label: "Enlace roto" },
	{ value: "spam", label: "Spam" },
	{ value: "other", label: "Otro motivo" },
] as const;

interface ReportButtonProps {
	resourceSlug: string;
	currentUserId?: string | null;
}

export function ReportButton({ resourceSlug, currentUserId }: ReportButtonProps) {
	const [open, setOpen] = useState(false);
	const [reason, setReason] = useState("");
	const [description, setDescription] = useState("");
	const [busy, setBusy] = useState(false);
	const [success, setSuccess] = useState(false);
	const [error, setError] = useState("");

	function handleOpen() {
		if (!currentUserId) {
			window.location.href = url("login");
			return;
		}
		setOpen(true);
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!reason) return;

		setBusy(true);
		setError("");
		try {
			const api = await getApiClient();
			await api.reportResource(resourceSlug, reason, description || undefined);
			setSuccess(true);
			setTimeout(() => {
				setOpen(false);
				setSuccess(false);
				setReason("");
				setDescription("");
			}, 2000);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Error al enviar la denuncia");
		} finally {
			setBusy(false);
		}
	}

	return (
		<>
			<button
				type="button"
				className="meta-action-btn"
				onClick={handleOpen}
				aria-label="Reportar recurso"
			>
				<span className="material-symbols-outlined" aria-hidden="true">flag</span>
				Reportar
			</button>

			<ModalFrame open={open} className="admin-confirm-dialog" titleId="report-dialog-title" onClose={() => setOpen(false)}>
				<form onSubmit={handleSubmit}>
					<h2 id="report-dialog-title" style={{ margin: "0 0 1rem", fontSize: "1.25rem" }}>
						Reportar recurso
					</h2>

					{success ? (
						<p style={{ color: "var(--color-primary)" }}>
							Denuncia enviada correctamente. Sera revisada por un moderador.
						</p>
					) : (
						<>
							<div style={{ marginBottom: "1rem" }}>
								<label htmlFor="report-reason" style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
									Motivo *
								</label>
								<select
									id="report-reason"
									value={reason}
									onChange={(e) => setReason(e.target.value)}
									required
									style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--color-outline)" }}
								>
									<option value="">Selecciona un motivo</option>
									{REPORT_REASONS.map((r) => (
										<option key={r.value} value={r.value}>{r.label}</option>
									))}
								</select>
							</div>

							<div style={{ marginBottom: "1rem" }}>
								<label htmlFor="report-description" style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
									Descripcion (opcional)
								</label>
								<textarea
									id="report-description"
									value={description}
									onChange={(e) => setDescription(e.target.value)}
									maxLength={2000}
									rows={4}
									style={{ width: "100%", padding: "0.5rem", borderRadius: "6px", border: "1px solid var(--color-outline)", resize: "vertical" }}
									placeholder="Describe el problema con mas detalle..."
								/>
							</div>

							{error ? <p style={{ color: "var(--color-error)", marginBottom: "0.5rem" }}>{error}</p> : null}

							<div className="admin-dialog-actions">
								<button type="button" className="admin-btn" onClick={() => setOpen(false)} disabled={busy}>
									Cancelar
								</button>
								<button type="submit" className="admin-btn admin-btn--danger" disabled={busy || !reason}>
									{busy ? "Enviando..." : "Enviar denuncia"}
								</button>
							</div>
						</>
					)}
				</form>
			</ModalFrame>
		</>
	);
}
