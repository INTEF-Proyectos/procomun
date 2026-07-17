import { useCallback, useEffect, useState } from "react";
import type {
	ApiTokenRecord,
	ApiTokenStats,
	UserRecord,
} from "../../lib/api-client.ts";
import { getApiClient } from "../../lib/get-api-client.ts";
import * as m from "../../paraglide/messages.js";
import { ApiKeyRevokeDialog } from "../dashboard/ApiKeyRevokeDialog.tsx";

/** Valores del <select> de estado; "" es "todos". */
type ApiTokenStatusFilter = "" | "active" | "revoked" | "expired";

export function AdminApiTokensSection() {
	const [keys, setKeys] = useState<ApiTokenRecord[]>([]);
	const [stats, setStats] = useState<ApiTokenStats | null>(null);
	const [users, setUsers] = useState<UserRecord[]>([]);
	const [loading, setLoading] = useState(true);

	// Filters
	const [selectedUserId, setSelectedUserId] = useState("");
	const [selectedStatus, setSelectedStatus] =
		useState<ApiTokenStatusFilter>("");

	// Revoke dialog state
	const [revokeId, setRevokeId] = useState<string | null>(null);
	const [revokeName, setRevokeName] = useState("");

	const fetchData = useCallback(async () => {
		try {
			const api = await getApiClient();
			const [keysData, statsData, usersData] = await Promise.all([
				api.listAllApiTokens({
					userId: selectedUserId || undefined,
					status: selectedStatus || undefined,
				}),
				api.getGlobalApiTokenStats(),
				api.listUsers({ limit: 100 }),
			]);
			setKeys(keysData);
			setStats(statsData);
			setUsers(usersData.data);
		} catch {
			// ignore
		} finally {
			setLoading(false);
		}
	}, [selectedUserId, selectedStatus]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	function getStatus(key: ApiTokenRecord): "active" | "revoked" | "expired" {
		if (key.revokedAt) return "revoked";
		if (key.expiresAt && new Date(key.expiresAt) <= new Date())
			return "expired";
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

	if (loading && !stats) {
		return (
			<div style={{ padding: "2rem" }}>
				Cargando control de claves de API...
			</div>
		);
	}

	return (
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				gap: "2rem",
				padding: "1rem",
			}}
		>
			<div>
				<h2
					style={{
						fontSize: "1.75rem",
						fontWeight: "800",
						margin: 0,
						color: "var(--color-on-surface)",
					}}
				>
					{m.api_keys_admin_title()}
				</h2>
				<p
					style={{
						fontSize: "0.875rem",
						color: "var(--color-on-surface-variant)",
						margin: "0.25rem 0 0 0",
					}}
				>
					{m.api_keys_admin_desc()}
				</p>
			</div>

			{/* Stats grid */}
			{stats && (
				<div
					style={{
						display: "grid",
						gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
						gap: "1.5rem",
					}}
				>
					<div
						style={{
							padding: "1.5rem",
							borderRadius: "1rem",
							background: "var(--color-surface-container-lowest)",
							border: "1px solid var(--color-outline-variant)",
							boxShadow: "0 4px 12px rgba(0,0,0,0.02)",
						}}
					>
						<div
							style={{
								fontSize: "0.875rem",
								color: "var(--color-on-surface-variant)",
							}}
						>
							{m.api_keys_admin_stat_active()}
						</div>
						<div
							style={{
								fontSize: "2rem",
								fontWeight: "800",
								marginTop: "0.5rem",
								color: "var(--color-primary)",
							}}
						>
							{stats.activeCount}
						</div>
					</div>
					<div
						style={{
							padding: "1.5rem",
							borderRadius: "1rem",
							background: "var(--color-surface-container-lowest)",
							border: "1px solid var(--color-outline-variant)",
							boxShadow: "0 4px 12px rgba(0,0,0,0.02)",
						}}
					>
						<div
							style={{
								fontSize: "0.875rem",
								color: "var(--color-on-surface-variant)",
							}}
						>
							{m.api_keys_admin_stat_revoked()}
						</div>
						<div
							style={{
								fontSize: "2rem",
								fontWeight: "800",
								marginTop: "0.5rem",
								color: "#dc2626",
							}}
						>
							{stats.revokedCount}
						</div>
					</div>
					<div
						style={{
							padding: "1.5rem",
							borderRadius: "1rem",
							background: "var(--color-surface-container-lowest)",
							border: "1px solid var(--color-outline-variant)",
							boxShadow: "0 4px 12px rgba(0,0,0,0.02)",
						}}
					>
						<div
							style={{
								fontSize: "0.875rem",
								color: "var(--color-on-surface-variant)",
							}}
						>
							{m.api_keys_admin_stat_requests()}
						</div>
						<div
							style={{
								fontSize: "2rem",
								fontWeight: "800",
								marginTop: "0.5rem",
								color: "var(--color-tertiary)",
							}}
						>
							{stats.totalRequests}
						</div>
					</div>
				</div>
			)}

			{/* Filters */}
			<div
				style={{
					display: "flex",
					flexWrap: "wrap",
					gap: "1rem",
					padding: "1rem",
					background: "var(--color-surface-container-low)",
					borderRadius: "0.75rem",
				}}
			>
				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: "0.25rem",
						minWidth: "200px",
					}}
				>
					<label
						htmlFor="filter-user"
						style={{
							fontSize: "0.75rem",
							fontWeight: "700",
							color: "var(--color-on-surface-variant)",
						}}
					>
						{m.api_keys_admin_filter_user()}
					</label>
					<select
						id="filter-user"
						value={selectedUserId}
						onChange={(e) => setSelectedUserId(e.target.value)}
						style={{
							padding: "0.5rem",
							borderRadius: "0.375rem",
							border: "1px solid var(--color-outline)",
							background: "var(--color-surface)",
							color: "var(--color-on-surface)",
						}}
					>
						<option value="">{m.api_keys_admin_filter_all_users()}</option>
						{users.map((u) => (
							<option key={u.id} value={u.id}>
								{u.name ? `${u.name} (${u.email})` : u.email}
							</option>
						))}
					</select>
				</div>

				<div
					style={{
						display: "flex",
						flexDirection: "column",
						gap: "0.25rem",
						minWidth: "200px",
					}}
				>
					<label
						htmlFor="filter-status"
						style={{
							fontSize: "0.75rem",
							fontWeight: "700",
							color: "var(--color-on-surface-variant)",
						}}
					>
						{m.api_keys_admin_filter_status()}
					</label>
					<select
						id="filter-status"
						value={selectedStatus}
						onChange={(e) =>
							setSelectedStatus(e.target.value as ApiTokenStatusFilter)
						}
						style={{
							padding: "0.5rem",
							borderRadius: "0.375rem",
							border: "1px solid var(--color-outline)",
							background: "var(--color-surface)",
							color: "var(--color-on-surface)",
						}}
					>
						<option value="">{m.api_keys_admin_filter_all_status()}</option>
						<option value="active">{m.api_keys_status_active()}</option>
						<option value="revoked">{m.api_keys_status_revoked()}</option>
						<option value="expired">{m.api_keys_status_expired()}</option>
					</select>
				</div>
			</div>

			{/* Table */}
			{keys.length === 0 ? (
				<div
					style={{
						textAlign: "center",
						padding: "3rem",
						background: "var(--color-surface-container-lowest)",
						borderRadius: "0.75rem",
						border: "1px dashed var(--color-outline)",
					}}
				>
					<span
						className="material-symbols-outlined"
						style={{ fontSize: "48px", color: "var(--color-outline)" }}
					>
						vpn_key
					</span>
					<p
						style={{
							marginTop: "1rem",
							color: "var(--color-on-surface-variant)",
						}}
					>
						No se encontraron claves de API.
					</p>
				</div>
			) : (
				<div
					style={{
						overflowX: "auto",
						border: "1px solid var(--color-outline-variant)",
						borderRadius: "0.75rem",
						background: "var(--color-surface)",
					}}
				>
					<table
						style={{
							width: "100%",
							borderCollapse: "collapse",
							textAlign: "left",
							fontSize: "0.875rem",
						}}
					>
						<thead>
							<tr
								style={{
									borderBottom: "1px solid var(--color-outline-variant)",
									background: "var(--color-surface-container-low)",
									color: "var(--color-on-surface-variant)",
								}}
							>
								<th style={{ padding: "1rem" }}>
									{m.api_keys_admin_col_user()}
								</th>
								<th style={{ padding: "1rem" }}>{m.api_keys_col_name()}</th>
								<th style={{ padding: "1rem" }}>{m.api_keys_col_prefix()}</th>
								<th style={{ padding: "1rem" }}>{m.api_keys_col_status()}</th>
								<th style={{ padding: "1rem" }}>{m.api_keys_col_created()}</th>
								<th style={{ padding: "1rem" }}>{m.api_keys_col_expires()}</th>
								<th style={{ padding: "1rem" }}>
									{m.api_keys_col_last_used()}
								</th>
								<th style={{ padding: "1rem" }}>{m.api_keys_col_requests()}</th>
								<th style={{ padding: "1rem", textAlign: "right" }}>
									{m.api_keys_col_actions()}
								</th>
							</tr>
						</thead>
						<tbody>
							{keys.map((key) => {
								const status = getStatus(key);
								return (
									<tr
										key={key.id}
										style={{
											borderBottom: "1px solid var(--color-outline-variant)",
											color: "var(--color-on-surface)",
										}}
									>
										<td style={{ padding: "1rem" }}>
											<div style={{ fontWeight: "600" }}>
												{key.user?.name || m.common_anonymous()}
											</div>
											<div
												style={{
													fontSize: "0.75rem",
													color: "var(--color-on-surface-variant)",
												}}
											>
												{key.user?.email}
											</div>
										</td>
										<td style={{ padding: "1rem", fontWeight: "500" }}>
											{key.name}
										</td>
										<td style={{ padding: "1rem" }}>
											<code
												style={{
													background: "var(--color-surface-container-high)",
													padding: "0.2rem 0.4rem",
													borderRadius: "0.25rem",
													fontFamily: "monospace",
												}}
											>
												{key.tokenPrefix}...
											</code>
										</td>
										<td style={{ padding: "1rem" }}>{getStatusBadge(key)}</td>
										<td
											style={{
												padding: "1rem",
												color: "var(--color-on-surface-variant)",
											}}
										>
											{formatDate(key.createdAt)}
										</td>
										<td
											style={{
												padding: "1rem",
												color: "var(--color-on-surface-variant)",
											}}
										>
											{key.expiresAt
												? formatDate(key.expiresAt)
												: m.api_keys_no_expiration()}
										</td>
										<td
											style={{
												padding: "1rem",
												color: "var(--color-on-surface-variant)",
											}}
										>
											{key.lastUsedAt
												? formatDate(key.lastUsedAt)
												: m.api_keys_never_used()}
										</td>
										<td style={{ padding: "1rem", fontWeight: "500" }}>
											{key.requestCount}
										</td>
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
													<span
														className="material-symbols-outlined"
														style={{ fontSize: "20px" }}
													>
														delete_forever
													</span>
												</button>
											) : (
												<span
													style={{
														color: "var(--color-outline)",
														fontSize: "0.75rem",
														fontStyle: "italic",
													}}
												>
													-
												</span>
											)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}

			<ApiKeyRevokeDialog
				open={revokeId !== null}
				onClose={() => {
					setRevokeId(null);
					setRevokeName("");
				}}
				onRevoked={fetchData}
				tokenId={revokeId}
				tokenName={revokeName}
				isAdmin={true}
			/>
		</div>
	);
}
