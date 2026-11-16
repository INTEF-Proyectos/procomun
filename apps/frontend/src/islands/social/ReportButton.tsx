import { useState } from "react";
import type { ApiClient } from "../../lib/api-client.ts";
import { getApiClient } from "../../lib/get-api-client.ts";
import "../../lib/paraglide-client.ts";
import { url } from "../../lib/paths.ts";
import {
	REPORT_REASON_VALUES,
	type ReportTarget,
	reportReasonLabel,
} from "../../lib/report-labels.ts";
import * as m from "../../paraglide/messages.js";
import { ModalFrame } from "../shared/ModalFrame.tsx";

interface ReportButtonProps {
	/** Qué se denuncia (#539): un recurso o una colección. */
	target: ReportTarget;
	slug: string;
	currentUserId?: string | null;
	className?: string;
}

/** Envía la denuncia al endpoint de lo denunciado. */
export function sendReport(
	api: Pick<ApiClient, "reportResource" | "reportCollection">,
	target: ReportTarget,
	slug: string,
	reason: string,
	description: string,
) {
	const detail = description || undefined;
	return target === "collection"
		? api.reportCollection(slug, reason, detail)
		: api.reportResource(slug, reason, detail);
}

export function ReportButton({
	target,
	slug,
	currentUserId,
	className = "meta-action-btn",
}: ReportButtonProps) {
	const [open, setOpen] = useState(false);
	const [reason, setReason] = useState("");
	const [description, setDescription] = useState("");
	const [busy, setBusy] = useState(false);
	const [success, setSuccess] = useState(false);
	const [error, setError] = useState("");
	const title =
		target === "collection"
			? m.report_collection_title()
			: m.report_resource_title();

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
			await sendReport(api, target, slug, reason, description);
			setSuccess(true);
			setTimeout(() => {
				setOpen(false);
				setSuccess(false);
				setReason("");
				setDescription("");
			}, 2000);
		} catch (err) {
			setError(err instanceof Error ? err.message : m.report_error());
		} finally {
			setBusy(false);
		}
	}

	return (
		<>
			<button
				type="button"
				className={className}
				onClick={handleOpen}
				aria-label={title}
			>
				<span className="material-symbols-outlined" aria-hidden="true">
					flag
				</span>
				{m.report_button()}
			</button>

			<ModalFrame
				open={open}
				className="admin-confirm-dialog"
				titleId="report-dialog-title"
				onClose={() => setOpen(false)}
			>
				<form onSubmit={handleSubmit}>
					<h2
						id="report-dialog-title"
						style={{ margin: "0 0 1rem", fontSize: "1.25rem" }}
					>
						{title}
					</h2>

					{success ? (
						<p role="status" style={{ color: "var(--color-primary)" }}>
							{m.report_success()}
						</p>
					) : (
						<>
							<div style={{ marginBottom: "1rem" }}>
								<label
									htmlFor="report-reason"
									style={{
										display: "block",
										marginBottom: "0.5rem",
										fontWeight: 500,
									}}
								>
									{m.report_reason_label()} *
								</label>
								<select
									id="report-reason"
									value={reason}
									onChange={(e) => setReason(e.target.value)}
									required
									style={{
										width: "100%",
										padding: "0.5rem",
										borderRadius: "6px",
										border: "1px solid var(--color-outline)",
									}}
								>
									<option value="">{m.report_reason_placeholder()}</option>
									{REPORT_REASON_VALUES.map((value) => (
										<option key={value} value={value}>
											{reportReasonLabel(value)}
										</option>
									))}
								</select>
							</div>

							<div style={{ marginBottom: "1rem" }}>
								<label
									htmlFor="report-description"
									style={{
										display: "block",
										marginBottom: "0.5rem",
										fontWeight: 500,
									}}
								>
									{m.report_description_label()}
								</label>
								<textarea
									id="report-description"
									value={description}
									onChange={(e) => setDescription(e.target.value)}
									maxLength={2000}
									rows={4}
									style={{
										width: "100%",
										padding: "0.5rem",
										borderRadius: "6px",
										border: "1px solid var(--color-outline)",
										resize: "vertical",
									}}
									placeholder={m.report_description_placeholder()}
								/>
							</div>

							{error ? (
								<p
									role="alert"
									style={{
										color: "var(--color-error)",
										marginBottom: "0.5rem",
									}}
								>
									{error}
								</p>
							) : null}

							<div className="admin-dialog-actions">
								<button
									type="button"
									className="admin-btn"
									onClick={() => setOpen(false)}
									disabled={busy}
								>
									{m.report_cancel()}
								</button>
								<button
									type="submit"
									className="admin-btn admin-btn--danger"
									disabled={busy || !reason}
								>
									{busy ? m.report_sending() : m.report_submit()}
								</button>
							</div>
						</>
					)}
				</form>
			</ModalFrame>
		</>
	);
}
