import { useState } from "react";
import { getApiClient } from "../../lib/get-api-client.ts";
import * as m from "../../paraglide/messages.js";
import { Dialog } from "../../ui/Dialog.tsx";

interface ApiKeyRevokeDialogProps {
	open: boolean;
	onClose: () => void;
	onRevoked: () => void;
	tokenId: string | null;
	tokenName: string;
	isAdmin?: boolean; // if true, uses revokeApiTokenAdmin instead of revokeApiToken
}

export function ApiKeyRevokeDialog({
	open,
	onClose,
	onRevoked,
	tokenId,
	tokenName,
	isAdmin = false,
}: ApiKeyRevokeDialogProps) {
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleConfirm() {
		if (!tokenId) return;

		setLoading(true);
		setError(null);

		try {
			const api = await getApiClient();
			if (isAdmin) {
				await api.revokeApiTokenAdmin(tokenId);
			} else {
				await api.revokeApiToken(tokenId);
			}
			onRevoked();
			onClose();
		} catch (err: any) {
			setError(err.message || "Error al revocar la clave de API");
		} finally {
			setLoading(false);
		}
	}

	return (
		<Dialog
			open={open}
			onClose={onClose}
			title={m.api_keys_revoke_dialog_title()}
			size="sm"
		>
			<div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
				{error && (
					<div
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

				<p
					style={{
						fontSize: "0.875rem",
						color: "var(--color-on-surface-variant)",
						lineHeight: 1.5,
					}}
				>
					{m.api_keys_revoke_dialog_desc({ name: tokenName })}
				</p>

				<div
					style={{
						display: "flex",
						justifyContent: "flex-end",
						gap: "0.75rem",
						marginTop: "1rem",
					}}
				>
					<button
						type="button"
						onClick={onClose}
						disabled={loading}
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
						type="button"
						onClick={handleConfirm}
						disabled={loading}
						style={{
							padding: "0.75rem 1.5rem",
							borderRadius: "0.5rem",
							border: "none",
							background: "var(--color-error)",
							color: "var(--color-on-error)",
							cursor: "pointer",
							opacity: loading ? 0.7 : 1,
						}}
					>
						{loading ? "Revocando..." : m.api_keys_revoke_dialog_confirm()}
					</button>
				</div>
			</div>
		</Dialog>
	);
}
