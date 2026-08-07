import {
	type FormEvent,
	startTransition,
	useCallback,
	useEffect,
	useState,
} from "react";
import type { TagRecord } from "../../lib/api-client.ts";
import { getApiClient } from "../../lib/get-api-client.ts";
import { ROLE_LEVELS, roleLevelOf } from "../../lib/shared-utils.ts";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import { ModalFrame } from "../shared/ModalFrame.tsx";
import { AdminTable, type Column } from "./AdminTable.tsx";

const PAGE_SIZE = 10;

function formatDate(d: TagRecord["updatedAt"]): string {
	if (!d) return "-";
	return new Date(d as string | number).toLocaleDateString("es-ES", {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

export function AdminTagsSection() {
	const [rows, setRows] = useState<TagRecord[]>([]);
	const [allTags, setAllTags] = useState<TagRecord[]>([]);
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(1);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [userRole, setUserRole] = useState("curator");

	const [editTarget, setEditTarget] = useState<TagRecord | null>(null);
	const [editLabel, setEditLabel] = useState("");
	const [editDescription, setEditDescription] = useState("");
	const [editBusy, setEditBusy] = useState(false);
	const [editError, setEditError] = useState("");

	const [mergeSource, setMergeSource] = useState<TagRecord | null>(null);
	const [mergeTargetId, setMergeTargetId] = useState("");
	const [similar, setSimilar] = useState<TagRecord[]>([]);
	const [mergeBusy, setMergeBusy] = useState(false);
	const [mergeError, setMergeError] = useState("");

	const [deleteTarget, setDeleteTarget] = useState<TagRecord | null>(null);
	const [busyDelete, setBusyDelete] = useState(false);

	const [migrateBusy, setMigrateBusy] = useState(false);
	const [migrateMsg, setMigrateMsg] = useState("");

	const loadTags = useCallback(async (nextPage: number, nextSearch: string) => {
		setLoading(true);
		try {
			const api = await getApiClient();
			const result = await api.listAdminTags({
				q: nextSearch || undefined,
				limit: PAGE_SIZE,
				offset: (nextPage - 1) * PAGE_SIZE,
			});
			startTransition(() => {
				setRows(result.data);
				setTotal(result.total);
				setPage(nextPage);
			});
		} catch {
			setRows([]);
			setTotal(0);
		} finally {
			setLoading(false);
		}
	}, []);

	const loadAllTags = useCallback(async () => {
		try {
			const api = await getApiClient();
			const result = await api.listAdminTags({ limit: 200, offset: 0 });
			setAllTags(result.data);
		} catch {
			setAllTags([]);
		}
	}, []);

	useEffect(() => {
		void (async () => {
			try {
				const api = await getApiClient();
				const session = await api.getSession();
				setUserRole(session?.user.role ?? "curator");
			} catch {
				/* keep default */
			}
			await loadTags(1, "");
			await loadAllTags();
		})();
	}, [loadTags, loadAllTags]);

	const isAdmin = roleLevelOf(userRole) >= ROLE_LEVELS.admin;

	function applySearch() {
		void loadTags(1, search.trim());
	}

	function openEdit(tag: TagRecord) {
		setEditTarget(tag);
		setEditLabel(tag.label);
		setEditDescription(tag.description ?? "");
		setEditError("");
	}

	async function handleEdit(event: FormEvent) {
		event.preventDefault();
		if (!editTarget) return;
		setEditBusy(true);
		setEditError("");
		try {
			const api = await getApiClient();
			await api.updateAdminTag(editTarget.id, {
				label: editLabel,
				description: editDescription || null,
			});
			setEditTarget(null);
			await loadTags(page, search.trim());
			await loadAllTags();
		} catch (err) {
			const msg =
				err && typeof err === "object" && "error" in err
					? String((err as { error: unknown }).error)
					: "No se pudo actualizar la etiqueta.";
			setEditError(msg);
		} finally {
			setEditBusy(false);
		}
	}

	async function openMerge(tag: TagRecord) {
		setMergeSource(tag);
		setMergeTargetId("");
		setMergeError("");
		try {
			const api = await getApiClient();
			const hits = await api.listSimilarAdminTags(tag.id);
			setSimilar(hits);
			if (hits[0]) setMergeTargetId(hits[0].id);
		} catch {
			setSimilar([]);
		}
	}

	async function handleMerge(event: FormEvent) {
		event.preventDefault();
		if (!mergeSource || !mergeTargetId) return;
		setMergeBusy(true);
		setMergeError("");
		try {
			const api = await getApiClient();
			await api.mergeAdminTags(mergeSource.id, mergeTargetId);
			setMergeSource(null);
			await loadTags(page, search.trim());
			await loadAllTags();
		} catch (err) {
			const msg =
				err && typeof err === "object" && "error" in err
					? String((err as { error: unknown }).error)
					: "No se pudo fusionar.";
			setMergeError(msg);
		} finally {
			setMergeBusy(false);
		}
	}

	async function handleDelete() {
		if (!deleteTarget) return;
		setBusyDelete(true);
		try {
			const api = await getApiClient();
			await api.deleteAdminTag(deleteTarget.id);
			setDeleteTarget(null);
			const nextPage = rows.length === 1 && page > 1 ? page - 1 : page;
			await loadTags(nextPage, search.trim());
			await loadAllTags();
		} catch {
			/* silent */
		} finally {
			setBusyDelete(false);
		}
	}

	async function handleMigrate() {
		if (!isAdmin) return;
		setMigrateBusy(true);
		setMigrateMsg("");
		try {
			const api = await getApiClient();
			const stats = await api.migrateKeywordsToTags();
			setMigrateMsg(
				`Migrados ${stats.resourcesProcessed} recursos · +${stats.tagsCreated} tags · +${stats.linksCreated} enlaces`,
			);
			await loadTags(1, search.trim());
			await loadAllTags();
		} catch {
			setMigrateMsg("Error al migrar keywords.");
		} finally {
			setMigrateBusy(false);
		}
	}

	const columns: Column<TagRecord>[] = [
		{
			key: "label",
			label: "Etiqueta",
			render: (t) => (
				<div>
					<div className="admin-resource-title">{t.label}</div>
					<div className="admin-resource-id">{t.slug}</div>
				</div>
			),
		},
		{
			key: "usage",
			label: "Uso",
			render: (t) => (
				<span className="admin-collection-meta">{t.usageCount}</span>
			),
		},
		{
			key: "updatedAt",
			label: "Actualizado",
			render: (t) => (
				<span className="admin-date-cell">{formatDate(t.updatedAt)}</span>
			),
		},
		{
			key: "actions",
			label: "Acciones",
			headerClassName: "admin-table-th-right",
			render: (t) => (
				<div className="admin-actions-cell">
					<button
						type="button"
						className="admin-action-btn admin-action-btn--edit"
						onClick={() => openEdit(t)}
						aria-label={`Editar ${t.label}`}
					>
						<span className="material-symbols-outlined">edit</span>
					</button>
					<button
						type="button"
						className="admin-action-btn admin-action-btn--edit"
						onClick={() => void openMerge(t)}
						aria-label={`Fusionar ${t.label}`}
					>
						<span className="material-symbols-outlined">merge</span>
					</button>
					<button
						type="button"
						className="admin-action-btn admin-action-btn--delete"
						disabled={busyDelete}
						onClick={() => setDeleteTarget(t)}
						aria-label={`Eliminar ${t.label}`}
					>
						<span className="material-symbols-outlined">delete</span>
					</button>
				</div>
			),
		},
	];

	return (
		<>
			<div className="admin-section-header">
				<h1>Etiquetas</h1>
				<p>
					Gestion atomizada de tags: edicion, fusion de duplicados y migracion
					desde keywords.
				</p>
			</div>

			<div className="admin-filter-bar">
				<div className="admin-filter-bar-inner">
					<div className="admin-filter-search">
						<span className="admin-filter-label">Buscar etiqueta</span>
						<div className="admin-search-wrap">
							<input
								type="search"
								className="admin-search-input"
								placeholder="Label o slug..."
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										applySearch();
									}
								}}
							/>
							<span
								className="material-symbols-outlined admin-search-icon"
								aria-hidden="true"
							>
								search
							</span>
						</div>
					</div>
					<div
						style={{ display: "flex", alignItems: "flex-end", gap: "0.5rem" }}
					>
						<button
							type="button"
							className="admin-form-btn admin-form-btn--primary"
							style={{ height: "3.5rem" }}
							onClick={applySearch}
						>
							Buscar
						</button>
						{isAdmin ? (
							<button
								type="button"
								className="admin-form-btn"
								style={{ height: "3.5rem", whiteSpace: "nowrap" }}
								disabled={migrateBusy}
								onClick={() => void handleMigrate()}
							>
								{migrateBusy ? "Migrando..." : "Migrar keywords"}
							</button>
						) : null}
					</div>
				</div>
				{migrateMsg ? (
					<p className="admin-list-status" role="status">
						{migrateMsg}
					</p>
				) : null}
			</div>

			<AdminTable<TagRecord>
				columns={columns}
				data={rows}
				getKey={(t) => t.id}
				loading={loading}
				total={total}
				page={page}
				pageSize={PAGE_SIZE}
				onPageChange={(p) => void loadTags(p, search.trim())}
				emptyMessage="No hay etiquetas para los filtros actuales."
			/>

			{editTarget ? (
				<ModalFrame
					open
					className="admin-edit-dialog"
					titleId="edit-tag-title"
					onClose={() => setEditTarget(null)}
				>
					<form onSubmit={(e) => void handleEdit(e)}>
						<h2 id="edit-tag-title">Editar etiqueta</h2>
						<div className="admin-form-field">
							<label htmlFor="tag-edit-label">Label</label>
							<input
								id="tag-edit-label"
								value={editLabel}
								onChange={(e) => setEditLabel(e.target.value)}
								required
							/>
						</div>
						<div className="admin-form-field">
							<label htmlFor="tag-edit-desc">Descripcion</label>
							<textarea
								id="tag-edit-desc"
								rows={3}
								value={editDescription}
								onChange={(e) => setEditDescription(e.target.value)}
							/>
						</div>
						{editError ? (
							<p className="admin-form-error" role="alert">
								{editError}
							</p>
						) : null}
						<div className="admin-dialog-actions">
							<button
								type="button"
								className="admin-btn"
								onClick={() => setEditTarget(null)}
							>
								Cancelar
							</button>
							<button
								type="submit"
								className="admin-btn admin-btn--primary"
								disabled={editBusy}
							>
								{editBusy ? "Guardando..." : "Guardar"}
							</button>
						</div>
					</form>
				</ModalFrame>
			) : null}

			{mergeSource ? (
				<ModalFrame
					open
					className="admin-edit-dialog"
					titleId="merge-tag-title"
					onClose={() => setMergeSource(null)}
				>
					<form onSubmit={(e) => void handleMerge(e)}>
						<h2 id="merge-tag-title">Fusionar «{mergeSource.label}»</h2>
						<p className="admin-collection-meta">
							Los recursos pasaran al tag destino y este quedara como sinonimo.
						</p>
						{similar.length > 0 ? (
							<p className="admin-list-status">
								Similares: {similar.map((s) => s.label).join(", ")}
							</p>
						) : null}
						<div className="admin-form-field">
							<label htmlFor="merge-target">Tag destino</label>
							<select
								id="merge-target"
								value={mergeTargetId}
								onChange={(e) => setMergeTargetId(e.target.value)}
								required
							>
								<option value="">Selecciona...</option>
								{allTags
									.filter((t) => t.id !== mergeSource.id)
									.map((t) => (
										<option key={t.id} value={t.id}>
											{t.label} ({t.slug}) · uso {t.usageCount}
										</option>
									))}
							</select>
						</div>
						{mergeError ? (
							<p className="admin-form-error" role="alert">
								{mergeError}
							</p>
						) : null}
						<div className="admin-dialog-actions">
							<button
								type="button"
								className="admin-btn"
								onClick={() => setMergeSource(null)}
							>
								Cancelar
							</button>
							<button
								type="submit"
								className="admin-btn admin-btn--primary"
								disabled={mergeBusy || !mergeTargetId}
							>
								{mergeBusy ? "Fusionando..." : "Fusionar"}
							</button>
						</div>
					</form>
				</ModalFrame>
			) : null}

			<ConfirmDialog
				open={deleteTarget !== null}
				title="Eliminar etiqueta"
				message={`Seguro que deseas eliminar «${deleteTarget?.label ?? "esta etiqueta"}»?`}
				confirmLabel="Eliminar"
				busy={busyDelete}
				onCancel={() => setDeleteTarget(null)}
				onConfirm={() => void handleDelete()}
			/>
		</>
	);
}
