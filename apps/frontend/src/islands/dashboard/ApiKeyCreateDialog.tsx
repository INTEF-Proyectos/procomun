import { useState } from "react";
import type { ApiTokenRecord } from "../../lib/api-client.ts";
import { getApiClient } from "../../lib/get-api-client.ts";
import * as m from "../../paraglide/messages.js";
import { Dialog } from "../../ui/Dialog.tsx";

interface ApiKeyCreateDialogProps {
	open: boolean;
	onClose: () => void;
	onCreated: () => void;
}

export function ApiKeyCreateDialog({
	open,
	onClose,
	onCreated,
}: ApiKeyCreateDialogProps) {
	const [name, setName] = useState("");
	const [expiryOption, setExpiryOption] = useState("never"); // "never" | "30" | "90" | "365" | "custom"
	const [customDate, setCustomDate] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [createdKey, setCreatedKey] = useState<ApiTokenRecord | null>(null);
	const [copied, setCopied] = useState(false);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!name.trim()) return;

		setLoading(true);
		setError(null);

		let expiresAt: string | undefined;
		if (expiryOption !== "never") {
			const date = new Date();
			if (expiryOption === "30") {
				date.setDate(date.getDate() + 30);
				expiresAt = date.toISOString();
			} else if (expiryOption === "90") {
				date.setDate(date.getDate() + 90);
				expiresAt = date.toISOString();
			} else if (expiryOption === "365") {
				date.setDate(date.getDate() + 365);
				expiresAt = date.toISOString();
			} else if (expiryOption === "custom" && customDate) {
				expiresAt = new Date(customDate).toISOString();
			}
		}

		try {
			const api = await getApiClient();
			const result = await api.createApiToken(name.trim(), expiresAt);
			setCreatedKey(result);
			onCreated();
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: String(err) || "Error al crear la clave de API",
			);
		} finally {
			setLoading(false);
		}
	}

	async function handleCopy() {
		if (!createdKey?.token) return;
		try {
			await navigator.clipboard.writeText(createdKey.token);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// ignore
		}
	}

	function handleClose() {
		setName("");
		setExpiryOption("never");
		setCustomDate("");
		setError(null);
		setCreatedKey(null);
		setCopied(false);
		onClose();
	}

	return (
		<Dialog
			open={open}
			onClose={handleClose}
			title={
				createdKey ? m.api_keys_create_dialog_title() : m.api_keys_create_btn()
			}
			size="md"
		>
			{!createdKey ? (
				<form
					onSubmit={handleSubmit}
					className="api-key-create-form"
					style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
				>
					{error && (
						<div
							className="api-key-error"
							style={{
								color: "var(--color-error)",
								fontSize: "0.875rem",
								padding: "0.5rem",
								background: "var(--color-error-container)",
								borderRadius: "0.5rem",
							}}
						>
							{error}
						</div>
					)}
					<div
						style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}
					>
						<label
							htmlFor="token-name"
							style={{ fontSize: "0.875rem", fontWeight: "600" }}
						>
							{m.api_keys_col_name()} *
						</label>
						<input
							id="token-name"
							type="text"
							required
							placeholder="Ej: Integración Moodle"
							value={name}
							onChange={(e) => setName(e.target.value)}
							style={{
								padding: "0.75rem",
								borderRadius: "0.5rem",
								border: "1px solid var(--color-outline)",
								background: "var(--color-surface)",
								color: "var(--color-on-surface)",
							}}
						/>
					</div>

					<div
						style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}
					>
						<label
							htmlFor="token-expiry"
							style={{ fontSize: "0.875rem", fontWeight: "600" }}
						>
							{m.api_keys_col_expires()}
						</label>
						<select
							id="token-expiry"
							value={expiryOption}
							onChange={(e) => setExpiryOption(e.target.value)}
							style={{
								padding: "0.75rem",
								borderRadius: "0.5rem",
								border: "1px solid var(--color-outline)",
								background: "var(--color-surface)",
								color: "var(--color-on-surface)",
							}}
						>
							<option value="never">{m.api_keys_no_expiration()}</option>
							<option value="30">30 días</option>
							<option value="90">90 días</option>
							<option value="365">1 año</option>
							<option value="custom">Personalizado</option>
						</select>
					</div>

					{expiryOption === "custom" && (
						<div
							style={{
								display: "flex",
								flexDirection: "column",
								gap: "0.25rem",
							}}
						>
							<label
								htmlFor="token-custom-date"
								style={{ fontSize: "0.875rem", fontWeight: "600" }}
							>
								Fecha de expiración
							</label>
							<input
								id="token-custom-date"
								type="date"
								required
								min={new Date().toISOString().split("T")[0]}
								value={customDate}
								onChange={(e) => setCustomDate(e.target.value)}
								style={{
									padding: "0.75rem",
									borderRadius: "0.5rem",
									border: "1px solid var(--color-outline)",
									background: "var(--color-surface)",
									color: "var(--color-on-surface)",
								}}
							/>
						</div>
					)}

					<div
						className="dialog-footer"
						style={{
							display: "flex",
							justifyContent: "flex-end",
							gap: "0.75rem",
							marginTop: "1rem",
						}}
					>
						<button
							type="button"
							onClick={handleClose}
							style={{
								padding: "0.75rem 1.5rem",
								borderRadius: "0.5rem",
								border: "1px solid var(--color-outline)",
								background: "transparent",
								color: "var(--color-on-surface)",
								cursor: "pointer",
							}}
						>
							{m.common_cancel()}
						</button>
						<button
							type="submit"
							disabled={loading || !name.trim()}
							style={{
								padding: "0.75rem 1.5rem",
								borderRadius: "0.5rem",
								border: "none",
								background: "var(--color-primary)",
								color: "var(--color-on-primary)",
								cursor: "pointer",
								opacity: loading || !name.trim() ? 0.7 : 1,
							}}
						>
							{loading ? "Creando..." : m.common_save()}
						</button>
					</div>
				</form>
			) : (
				<div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
					<p
						style={{
							fontSize: "0.875rem",
							color: "var(--color-on-surface-variant)",
						}}
					>
						{m.api_keys_create_dialog_desc()}
					</p>

					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: "0.5rem",
							padding: "0.75rem",
							background: "var(--color-surface-container-high)",
							borderRadius: "0.5rem",
							border: "1px solid var(--color-outline-variant)",
						}}
					>
						<code
							style={{
								flex: 1,
								fontFamily: "monospace",
								wordBreak: "break-all",
								fontSize: "0.95rem",
							}}
						>
							{createdKey.token}
						</code>
						<button
							type="button"
							onClick={handleCopy}
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								padding: "0.5rem",
								borderRadius: "0.25rem",
								border: "none",
								background: "var(--color-primary)",
								color: "var(--color-on-primary)",
								cursor: "pointer",
							}}
						>
							<span
								className="material-symbols-outlined"
								style={{ fontSize: "18px" }}
							>
								{copied ? "check" : "content_copy"}
							</span>
						</button>
					</div>

					<div
						style={{
							padding: "0.75rem",
							background: "var(--color-error-container)",
							color: "var(--color-on-error-container)",
							borderRadius: "0.5rem",
							fontSize: "0.875rem",
							fontWeight: "600",
						}}
					>
						{m.api_keys_create_dialog_warning()}
					</div>

					<div
						style={{
							display: "flex",
							justifyContent: "flex-end",
							marginTop: "1rem",
						}}
					>
						<button
							type="button"
							onClick={handleClose}
							style={{
								padding: "0.75rem 1.5rem",
								borderRadius: "0.5rem",
								border: "none",
								background: "var(--color-primary)",
								color: "var(--color-on-primary)",
								cursor: "pointer",
							}}
						>
							{m.common_close()}
						</button>
					</div>
				</div>
			)}
		</Dialog>
	);
}
