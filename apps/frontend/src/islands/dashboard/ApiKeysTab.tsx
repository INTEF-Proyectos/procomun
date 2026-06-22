import { useEffect, useState } from "react";
import { getApiClient } from "../../lib/get-api-client.ts";
import type { ApiTokenRecord } from "../../lib/api-client.ts";
import { ApiKeyCreateDialog } from "./ApiKeyCreateDialog.tsx";
import { ApiKeyRevokeDialog } from "./ApiKeyRevokeDialog.tsx";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import * as m from "../../paraglide/messages.js";

export function ApiKeysTab() {
	const [keys, setKeys] = useState<ApiTokenRecord[]>([]);
	const [loading, setLoading] = useState(true);
	const [createOpen, setCreateOpen] = useState(false);
	const [revokeId, setRevokeId] = useState<string | null>(null);
	const [revokeName, setRevokeName] = useState("");

	async function fetchKeys() {
		try {
			const api = await getApiClient();
			const data = await api.listApiTokens();
			setKeys(data);
		} catch {
			// ignore
		} finally {
			setLoading(false);
		}
	}

	useEffect(() => {
		fetchKeys();
	}, []);

	function getStatus(key: ApiTokenRecord): "active" | "revoked" | "expired" {
		if (key.revokedAt) return "revoked";
		if (key.expiresAt && new Date(key.expiresAt) <= new Date()) return "expired";
		return "active";
	}

	function getStatusBadge(key: ApiTokenRecord) {
		const status = getStatus(key);
		if (status === "active") {
			return (
				<span
					style={{
						padding: "0.25rem 0.5rem",
						background: "rgba(34, 197, 94, 0.1)",
						color: "#16a34a",
						borderRadius: "9999px",
						fontSize: "0.75rem",
						fontWeight: "600",
					}}
				>
					{m.api_keys_status_active()}
				</span>
			);
		}
		if (status === "revoked") {
			return (
				<span
					style={{
						padding: "0.25rem 0.5rem",
						background: "rgba(239, 68, 68, 0.1)",
						color: "#dc2626",
						borderRadius: "9999px",
						fontSize: "0.75rem",
						fontWeight: "600",
					}}
				>
					{m.api_keys_status_revoked()}
				</span>
			);
		}
		return (
			<span
				style={{
					padding: "0.25rem 0.5rem",
					background: "rgba(245, 158, 11, 0.1)",
					color: "#d97706",
					borderRadius: "9999px",
					fontSize: "0.75rem",
					fontWeight: "600",
				}}
			>
				{m.api_keys_status_expired()}
			</span>
		);
	}

	function formatDate(dateStr: string | null) {
		if (!dateStr) return null;
		return new Date(dateStr).toLocaleDateString("es-ES", {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	}

	if (loading) {
		return (
			<div className="dashboard-tab-content">
				<Skeleton lines={4} />
			</div>
		);
	}

	return (
		<div className="dashboard-tab-content" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
				<div>
					<h3 style={{ fontSize: "1.25rem", fontWeight: "700", margin: 0, color: "var(--color-on-surface)" }}>
						{m.api_keys_title()}
					</h3>
					<p style={{ fontSize: "0.875rem", color: "var(--color-on-surface-variant)", margin: "0.25rem 0 0 0" }}>
						{m.api_keys_desc()}
					</p>
				</div>
				<button
					type="button"
					onClick={() => setCreateOpen(true)}
					style={{
						display: "flex",
						alignItems: "center",
						gap: "0.5rem",
						padding: "0.75rem 1.25rem",
						borderRadius: "0.5rem",
						border: "none",
						background: "var(--color-primary)",
						color: "var(--color-on-primary)",
						fontWeight: "600",
						cursor: "pointer",
					}}
				>
					<span className="material-symbols-outlined" style={{ fontSize: "20px" }}>add</span>
					{m.api_keys_create_btn()}
				</button>
			</div>

			{keys.length === 0 ? (
				<EmptyState
					icon="vpn_key"
					title={m.api_keys_empty_title()}
					description={m.api_keys_empty_desc()}
					action={
						<button
							type="button"
							onClick={() => setCreateOpen(true)}
							style={{
								padding: "0.75rem 1.5rem",
								borderRadius: "0.5rem",
								border: "none",
								background: "var(--color-primary)",
								color: "var(--color-on-primary)",
								fontWeight: "600",
								cursor: "pointer",
							}}
						>
							{m.api_keys_create_btn()}
						</button>
					}
				/>
			) : (
				<div style={{ overflowX: "auto", border: "1px solid var(--color-outline-variant)", borderRadius: "0.75rem", background: "var(--color-surface)" }}>
					<table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "0.875rem" }}>
						<thead>
							<tr style={{ borderBottom: "1px solid var(--color-outline-variant)", background: "var(--color-surface-container-low)", color: "var(--color-on-surface-variant)" }}>
								<th style={{ padding: "1rem" }}>{m.api_keys_col_name()}</th>
								<th style={{ padding: "1rem" }}>{m.api_keys_col_prefix()}</th>
								<th style={{ padding: "1rem" }}>{m.api_keys_col_status()}</th>
								<th style={{ padding: "1rem" }}>{m.api_keys_col_created()}</th>
								<th style={{ padding: "1rem" }}>{m.api_keys_col_expires()}</th>
								<th style={{ padding: "1rem" }}>{m.api_keys_col_last_used()}</th>
								<th style={{ padding: "1rem" }}>{m.api_keys_col_requests()}</th>
								<th style={{ padding: "1rem", textAlign: "right" }}>{m.api_keys_col_actions()}</th>
							</tr>
						</thead>
						<tbody>
							{keys.map((key) => {
								const status = getStatus(key);
								return (
									<tr key={key.id} style={{ borderBottom: "1px solid var(--color-outline-variant)", color: "var(--color-on-surface)" }}>
										<td style={{ padding: "1rem", fontWeight: "600" }}>{key.name}</td>
										<td style={{ padding: "1rem" }}>
											<code style={{ background: "var(--color-surface-container-high)", padding: "0.2rem 0.4rem", borderRadius: "0.25rem", fontFamily: "monospace" }}>
												{key.tokenPrefix}...
											</code>
										</td>
										<td style={{ padding: "1rem" }}>{getStatusBadge(key)}</td>
										<td style={{ padding: "1rem", color: "var(--color-on-surface-variant)" }}>{formatDate(key.createdAt)}</td>
										<td style={{ padding: "1rem", color: "var(--color-on-surface-variant)" }}>
											{key.expiresAt ? formatDate(key.expiresAt) : m.api_keys_no_expiration()}
										</td>
										<td style={{ padding: "1rem", color: "var(--color-on-surface-variant)" }}>
											{key.lastUsedAt ? formatDate(key.lastUsedAt) : m.api_keys_never_used()}
										</td>
										<td style={{ padding: "1rem", fontWeight: "500" }}>{key.requestCount}</td>
										<td style={{ padding: "1rem", textAlign: "right" }}>
											{status === "active" ? (
												<button
													type="button"
													title={m.api_keys_revoke_tooltip()}
													onClick={() => {
														setRevokeId(key.id);
														setRevokeName(key.name);
													}}
													style={{
														background: "transparent",
														border: "none",
														color: "var(--color-error)",
														cursor: "pointer",
														padding: "0.25rem",
														display: "inline-flex",
														alignItems: "center",
														justifyContent: "center",
														borderRadius: "0.25rem",
													}}
												>
													<span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
														delete_forever
													</span>
												</button>
											) : (
												<span style={{ color: "var(--color-outline)", fontSize: "0.75rem", fontStyle: "italic" }}>-</span>
											)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}

			<ApiKeyCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={fetchKeys} />
			<ApiKeyRevokeDialog
				open={revokeId !== null}
				onClose={() => {
					setRevokeId(null);
					setRevokeName("");
				}}
				onRevoked={fetchKeys}
				tokenId={revokeId}
				tokenName={revokeName}
			/>
		</div>
	);
}
