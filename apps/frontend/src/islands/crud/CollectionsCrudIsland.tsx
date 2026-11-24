import {
	canManageCollection,
	collectionStatusChangeError,
	hasMinRole,
} from "@procomun/db/validation";
import {
	type FormEvent,
	startTransition,
	useCallback,
	useEffect,
	useState,
} from "react";
import type {
	CollectionRecord,
	CollectionResourceRecord,
	Resource,
} from "../../lib/api-client.ts";
import { getApiClient } from "../../lib/get-api-client.ts";
import { labelFor } from "../../lib/labels.ts";
import * as m from "../../paraglide/messages.js";
import { AccessibleFeedback } from "../shared/AccessibleFeedback.tsx";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import { ModalFrame } from "../shared/ModalFrame.tsx";
import { type CrudColumn, CrudTable } from "./CrudTable.tsx";
import "../admin/AdminPageIsland.css";

const PAGE_SIZE = 20;
const RESOURCE_SEARCH_LIMIT = 8;

const STATUS_LABELS: Record<string, () => string> = {
	draft: m.resource_draft,
	review: m.resource_in_review,
	published: m.resource_published,
	archived: m.resource_archived,
};

const STATUS_BADGES: Record<string, string> = {
	draft: "admin-badge--draft",
	review: "admin-badge--review",
	published: "admin-badge--published",
	archived: "admin-badge--archived",
};

interface CollectionFormState {
	title: string;
	description: string;
	coverImageUrl: string;
	editorialStatus: string;
	isOrdered: boolean;
}

const EMPTY_FORM: CollectionFormState = {
	title: "",
	description: "",
	coverImageUrl: "",
	editorialStatus: "draft",
	isOrdered: false,
};

function formatDate(dateValue: CollectionRecord["updatedAt"]) {
	if (!dateValue) return "-";
	return new Date(dateValue).toLocaleDateString("es-ES");
}

function truncate(text: string, maxLength: number) {
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength)}...`;
}

function statusLabel(status: string) {
	return labelFor(STATUS_LABELS, status)?.() ?? status;
}

function statusBadgeClass(status: string) {
	return STATUS_BADGES[status] ?? "";
}

function isOrderedValue(value: CollectionRecord["isOrdered"] | boolean) {
	return Boolean(value);
}

function coverPreview(url: string | null | undefined) {
	if (!url) return m.collection_no_cover();
	return m.collection_has_cover();
}

/**
 * #575: une las búsquedas de recursos (los gestionables y, para el propietario
 * sin rol de curación, el catálogo público) sin duplicados y sin los ya
 * enlazados. No recorta: cada búsqueda ya viene limitada, y recortar la unión
 * dejaba fuera el catálogo público cuando los propios llenaban el cupo (#624).
 */
export function mergeResourceCandidates(
	lists: readonly (readonly Resource[])[],
	excludedIds: ReadonlySet<string>,
): Resource[] {
	const candidates = new Map<string, Resource>();
	for (const list of lists) {
		for (const item of list) {
			if (!excludedIds.has(item.id)) candidates.set(item.id, item);
		}
	}
	return [...candidates.values()];
}

type CollectionViewer = { id: string; role?: string };

export interface CollectionColumnHandlers {
	user?: CollectionViewer;
	busyLoadEdit: boolean;
	onEdit: (id: string) => void;
	onDelete: (row: CollectionRecord) => void;
}

/** Columnas densas del listado admin de colecciones (#304). */
export function buildCollectionColumns(
	handlers: CollectionColumnHandlers,
): CrudColumn<CollectionRecord>[] {
	return [
		{
			id: "title",
			header: m.collection_title(),
			cell: (row) => (
				<div className="admin-collection-cell">
					<div className="admin-collection-title">{row.title}</div>
					<div className="admin-collection-meta">
						{row.curatorName ?? m.collection_no_curator()}
					</div>
				</div>
			),
		},
		{
			id: "status",
			header: m.my_resources_status_legend(),
			cell: (row) => (
				<span
					className={`admin-badge ${statusBadgeClass(row.editorialStatus)}`.trim()}
				>
					{statusLabel(row.editorialStatus)}
				</span>
			),
		},
		{
			id: "description",
			header: m.collection_description(),
			className: "admin-collection-cell--clamp",
			cell: (row) => {
				const text = (row.description ?? "").trim();
				if (!text) return <span className="admin-collection-meta">-</span>;
				return (
					<span className="admin-collection-ellipsis" title={text}>
						{text}
					</span>
				);
			},
		},
		{
			id: "cover",
			header: m.collection_cover(),
			className: "admin-collection-cell--clamp",
			cell: (row) => {
				const url = row.coverImageUrl?.trim() || "";
				const label = coverPreview(url || null);
				return (
					<span
						className="admin-collection-cover admin-collection-meta"
						title={url || undefined}
					>
						{label}
					</span>
				);
			},
		},
		{
			id: "resources",
			header: m.author_resources_title(),
			cell: (row) => (
				<span className="admin-collection-meta">
					{String(row.resourceCount ?? 0)}
				</span>
			),
		},
		{
			id: "updatedAt",
			header: m.collection_updated(),
			cell: (row) => (
				<span className="admin-collection-meta">
					{formatDate(row.updatedAt)}
				</span>
			),
		},
		{
			id: "actions",
			header: m.admin_reports_col_actions(),
			className: "admin-actions-cell",
			cell: (row) =>
				(!handlers.user || canManageCollection(handlers.user, row)) && (
					<div className="admin-actions-cell">
						<button
							type="button"
							className="admin-action-btn admin-action-btn--edit"
							disabled={handlers.busyLoadEdit}
							onClick={() => handlers.onEdit(row.id)}
							aria-label={m.profile_edit_resource({ title: row.title })}
						>
							<span className="material-symbols-outlined" aria-hidden="true">
								edit
							</span>
						</button>
						{(!handlers.user || hasMinRole(handlers.user.role, "curator")) && (
							<button
								type="button"
								className="admin-action-btn admin-action-btn--delete"
								onClick={() => handlers.onDelete(row)}
								aria-label={`Eliminar ${row.title}`}
							>
								<span className="material-symbols-outlined" aria-hidden="true">
									delete
								</span>
							</button>
						)}
					</div>
				),
		},
	];
}

export function CollectionsCrudIsland({
	user,
}: {
	user?: CollectionViewer;
} = {}) {
	const canCurate = !user || hasMinRole(user.role, "curator");
	const [rows, setRows] = useState<CollectionRecord[]>([]);
	const [search, setSearch] = useState("");
	const [appliedSearch, setAppliedSearch] = useState("");
	const [offset, setOffset] = useState(0);
	const [total, setTotal] = useState(0);
	const [statusMessage, setStatusMessage] = useState<string>(m.common_loading);
	const [createForm, setCreateForm] = useState(EMPTY_FORM);
	const [createFeedback, setCreateFeedback] = useState<{
		message: string;
		variant: "neutral" | "success" | "error";
	}>({
		message: "",
		variant: "neutral",
	});
	const [editing, setEditing] = useState<CollectionRecord | null>(null);
	const [editForm, setEditForm] = useState(EMPTY_FORM);
	const [editError, setEditError] = useState("");
	const [deleteTarget, setDeleteTarget] = useState<CollectionRecord | null>(
		null,
	);
	const [collectionResources, setCollectionResources] = useState<
		CollectionResourceRecord[]
	>([]);
	const [resourceSearch, setResourceSearch] = useState("");
	const [resourceResults, setResourceResults] = useState<Resource[]>([]);
	const [resourceFeedback, setResourceFeedback] = useState<{
		message: string;
		variant: "neutral" | "success" | "error";
	}>({
		message: "",
		variant: "neutral",
	});
	const [busyAction, setBusyAction] = useState<
		| "create"
		| "edit"
		| "delete"
		| "load-edit"
		| "resource-search"
		| "resource-add"
		| "resource-remove"
		| "resource-reorder"
		| null
	>(null);

	const loadCollections = useCallback(
		async (nextOffset: number, nextSearch: string) => {
			setStatusMessage(m.common_loading());

			try {
				const api = await getApiClient();
				const result = await api.listCollections({
					q: nextSearch || undefined,
					limit: PAGE_SIZE,
					offset: nextOffset,
				});

				if (!Array.isArray(result.data))
					throw new Error(m.collection_load_error());

				startTransition(() => {
					setRows(result.data);
					setOffset(result.offset);
					setTotal(result.total);
					setStatusMessage(m.collection_count({ count: String(result.total) }));
				});
			} catch {
				setRows([]);
				setTotal(0);
				setStatusMessage(m.collection_load_error());
			}
		},
		[],
	);

	async function loadCollectionResources(collectionId: string) {
		const api = await getApiClient();
		const items = await api.listCollectionResources(collectionId);
		setCollectionResources(items);
		return items;
	}

	async function searchResources(
		collectionId: string,
		query: string,
		linkedResources = collectionResources,
	) {
		setBusyAction("resource-search");
		setResourceFeedback({ message: "", variant: "neutral" });
		try {
			const api = await getApiClient();
			const options = {
				q: query || undefined,
				limit: RESOURCE_SEARCH_LIMIT,
				offset: 0,
			};
			// Si falla una de las dos búsquedas, valen los resultados de la otra.
			const settled = await Promise.allSettled([
				api.listAdminResources(options),
				...(canCurate ? [] : [api.listResources(options)]),
			]);
			const lists = settled.flatMap((result) =>
				result.status === "fulfilled" ? [result.value.data] : [],
			);
			if (lists.length === 0) throw new Error(m.catalog_error());
			setResourceResults(
				mergeResourceCandidates(
					lists,
					new Set([
						collectionId,
						...linkedResources.map((item) => item.resourceId),
					]),
				),
			);
		} catch {
			setResourceResults([]);
			setResourceFeedback({
				message: m.catalog_error(),
				variant: "error",
			});
		} finally {
			setBusyAction(null);
		}
	}

	useEffect(() => {
		void loadCollections(0, "");
	}, [loadCollections]);

	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

	const columns = buildCollectionColumns({
		user,
		busyLoadEdit: busyAction === "load-edit",
		onEdit: (id) => {
			void handleEditOpen(id);
		},
		onDelete: (row) => {
			setDeleteTarget(row);
		},
	});

	async function applyFilters() {
		const nextSearch = search.trim();
		setAppliedSearch(nextSearch);
		setOffset(0);
		await loadCollections(0, nextSearch);
	}

	async function handleEditOpen(id: string) {
		setBusyAction("load-edit");
		setEditError("");
		setResourceFeedback({ message: "", variant: "neutral" });
		setResourceSearch("");
		setResourceResults([]);

		try {
			const api = await getApiClient();
			const collection = await api.getCollectionById(id);
			if (!collection || (user && !canManageCollection(user, collection))) {
				setStatusMessage(m.collection_load_error());
				return;
			}

			setEditing(collection);
			setEditForm({
				title: collection.title,
				description: collection.description,
				coverImageUrl: collection.coverImageUrl ?? "",
				editorialStatus: collection.editorialStatus,
				isOrdered: isOrderedValue(collection.isOrdered),
			});
			await loadCollectionResources(collection.id);
		} catch {
			setStatusMessage(m.collection_load_error());
		} finally {
			setBusyAction(null);
		}
	}

	async function handleCreate(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setBusyAction("create");
		setCreateFeedback({ message: "", variant: "neutral" });

		try {
			const api = await getApiClient();
			await api.createCollection({
				title: createForm.title,
				description: createForm.description,
				coverImageUrl: createForm.coverImageUrl || null,
				isOrdered: createForm.isOrdered,
			});
			setCreateForm(EMPTY_FORM);
			setCreateFeedback({ message: "Coleccion creada.", variant: "success" });
			await loadCollections(0, appliedSearch);
		} catch {
			setCreateFeedback({
				message: "Error al crear la coleccion.",
				variant: "error",
			});
		} finally {
			setBusyAction(null);
		}
	}

	async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!editing) return;
		const submitter = (event.nativeEvent as SubmitEvent).submitter;
		const requestedStatus = canCurate
			? editForm.editorialStatus
			: submitter?.getAttribute("value") === "review"
				? "review"
				: undefined;
		const statusError =
			user &&
			collectionStatusChangeError(
				user,
				editing.editorialStatus,
				requestedStatus,
			);
		if (statusError) {
			setEditError(statusError);
			return;
		}

		setBusyAction("edit");
		setEditError("");

		try {
			const api = await getApiClient();
			const result = await api.updateCollection(editing.id, {
				title: editForm.title,
				description: editForm.description,
				coverImageUrl: editForm.coverImageUrl || null,
				editorialStatus: requestedStatus,
				isOrdered: editForm.isOrdered,
			});
			if (!result.ok) {
				setEditError(result.error ?? m.profile_save_error());
				return;
			}

			setEditing(null);
			setCollectionResources([]);
			setResourceResults([]);
			await loadCollections(offset, appliedSearch);
		} catch {
			setEditError(m.auth_connection_error());
		} finally {
			setBusyAction(null);
		}
	}

	async function handleDelete() {
		if (!deleteTarget) return;
		setBusyAction("delete");

		try {
			const api = await getApiClient();
			await api.deleteCollection(deleteTarget.id);
			const nextOffset =
				rows.length === 1 && offset > 0
					? Math.max(0, offset - PAGE_SIZE)
					: offset;
			setDeleteTarget(null);
			await loadCollections(nextOffset, appliedSearch);
		} catch {
			setStatusMessage("No se pudo eliminar la coleccion.");
		} finally {
			setBusyAction(null);
		}
	}

	async function handleAddResource(resourceId: string) {
		if (!editing) return;
		setBusyAction("resource-add");
		setResourceFeedback({ message: "", variant: "neutral" });
		try {
			const api = await getApiClient();
			await api.addResourceToCollection(editing.id, resourceId);
			const linked = await loadCollectionResources(editing.id);
			await searchResources(editing.id, resourceSearch.trim(), linked);
			setResourceFeedback({
				message: m.collection_resource_added(),
				variant: "success",
			});
		} catch {
			setResourceFeedback({
				message: m.collection_add_error(),
				variant: "error",
			});
		} finally {
			setBusyAction(null);
		}
	}

	async function handleRemoveResource(resourceId: string) {
		if (!editing) return;
		setBusyAction("resource-remove");
		setResourceFeedback({ message: "", variant: "neutral" });
		try {
			const api = await getApiClient();
			await api.removeResourceFromCollection(editing.id, resourceId);
			const linked = await loadCollectionResources(editing.id);
			await searchResources(editing.id, resourceSearch.trim(), linked);
			setResourceFeedback({
				message: m.collection_resource_removed(),
				variant: "success",
			});
		} catch {
			setResourceFeedback({
				message: m.collection_remove_error(),
				variant: "error",
			});
		} finally {
			setBusyAction(null);
		}
	}

	async function handleReorder(resourceId: string, direction: "up" | "down") {
		if (!editing) return;
		setBusyAction("resource-reorder");
		setResourceFeedback({ message: "", variant: "neutral" });
		try {
			const api = await getApiClient();
			const result = await api.reorderCollectionResource(
				editing.id,
				resourceId,
				direction,
			);
			if (!result.ok) {
				setResourceFeedback({
					message: result.error ?? m.collection_reorder_error(),
					variant: "error",
				});
				return;
			}
			await loadCollectionResources(editing.id);
		} catch {
			setResourceFeedback({
				message: m.collection_reorder_error(),
				variant: "error",
			});
		} finally {
			setBusyAction(null);
		}
	}

	return (
		<>
			{canCurate && (
				<section className="admin-inline-form">
					<h3>Nueva coleccion</h3>
					<form onSubmit={handleCreate}>
						<div className="admin-form-row">
							<div className="admin-form-field">
								<label htmlFor="collection-create-title">
									{m.collection_title()}
								</label>
								<input
									id="collection-create-title"
									value={createForm.title}
									onChange={(event) => {
										const value = event.currentTarget.value;
										setCreateForm((current) => ({ ...current, title: value }));
									}}
									required
								/>
							</div>
							<div className="admin-form-field">
								<label htmlFor="collection-create-cover">
									{m.collection_cover_url()}
								</label>
								<input
									id="collection-create-cover"
									type="url"
									placeholder="https://..."
									value={createForm.coverImageUrl}
									onChange={(event) => {
										const value = event.currentTarget.value;
										setCreateForm((current) => ({
											...current,
											coverImageUrl: value,
										}));
									}}
								/>
							</div>
						</div>
						<div className="admin-form-row admin-form-row--full">
							<div className="admin-form-field">
								<label htmlFor="collection-create-description">
									{m.collection_description()}
								</label>
								<textarea
									id="collection-create-description"
									rows={4}
									value={createForm.description}
									onChange={(event) => {
										const value = event.currentTarget.value;
										setCreateForm((current) => ({
											...current,
											description: value,
										}));
									}}
									required
								/>
							</div>
						</div>
						<div className="admin-form-row admin-form-row--full">
							<label
								className="admin-form-check"
								htmlFor="collection-create-ordered"
							>
								<input
									id="collection-create-ordered"
									type="checkbox"
									checked={createForm.isOrdered}
									onChange={(event) => {
										const checked = event.currentTarget.checked;
										setCreateForm((current) => ({
											...current,
											isOrdered: checked,
										}));
									}}
								/>
								{m.collection_ordered()}
							</label>
						</div>
						<div className="admin-form-actions">
							<button
								type="submit"
								className="admin-form-btn admin-form-btn--primary"
								disabled={busyAction === "create"}
							>
								{busyAction === "create" ? "Creando..." : "Crear coleccion"}
							</button>
						</div>
					</form>
					<AccessibleFeedback
						id="collections-create-feedback"
						message={createFeedback.message}
						variant={createFeedback.variant}
					/>
				</section>
			)}

			<section className="admin-toolbar">
				<label className="admin-toolbar-field">
					<span className="admin-toolbar-label">{m.common_search()}</span>
					<input
						type="search"
						placeholder={m.collection_search_hint()}
						value={search}
						onChange={(event) => setSearch(event.currentTarget.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								void applyFilters();
							}
						}}
					/>
				</label>
				<button
					type="button"
					className="admin-btn"
					onClick={() => void applyFilters()}
				>
					{m.collection_apply()}
				</button>
			</section>

			<div className="admin-list-status" aria-live="polite">
				{statusMessage}
			</div>

			<CrudTable
				columns={columns}
				rows={rows}
				getRowKey={(row) => row.id}
				emptyMessage={m.collection_empty()}
			/>

			{total > PAGE_SIZE && (
				<div className="admin-pager">
					<button
						type="button"
						onClick={() =>
							void loadCollections(
								Math.max(0, offset - PAGE_SIZE),
								appliedSearch,
							)
						}
						disabled={offset === 0}
					>
						{m.common_previous()}
					</button>
					<span className="admin-pager-label">
						{m.collection_page({
							page: String(currentPage),
							total: String(totalPages),
						})}
					</span>
					<button
						type="button"
						onClick={() =>
							void loadCollections(offset + PAGE_SIZE, appliedSearch)
						}
						disabled={offset + PAGE_SIZE >= total}
					>
						{m.common_next()}
					</button>
				</div>
			)}

			{editing ? (
				<ModalFrame
					open={editing !== null}
					className="admin-edit-dialog"
					titleId="edit-collection-title"
					onClose={() => {
						setEditing(null);
						setEditError("");
						setCollectionResources([]);
						setResourceResults([]);
						setResourceFeedback({ message: "", variant: "neutral" });
					}}
				>
					<h2 id="edit-collection-title">{m.collection_edit()}</h2>
					<form onSubmit={handleEditSubmit}>
						<div className="admin-form-row">
							<div className="admin-form-field">
								<label htmlFor="collection-edit-title">
									{m.collection_title()}
								</label>
								<input
									id="collection-edit-title"
									value={editForm.title}
									onChange={(event) => {
										const value = event.currentTarget.value;
										setEditForm((current) => ({ ...current, title: value }));
									}}
									required
								/>
							</div>
							<div className="admin-form-field">
								<label htmlFor="collection-edit-cover">
									{m.collection_cover_url()}
								</label>
								<input
									id="collection-edit-cover"
									type="url"
									placeholder="https://..."
									value={editForm.coverImageUrl}
									onChange={(event) => {
										const value = event.currentTarget.value;
										setEditForm((current) => ({
											...current,
											coverImageUrl: value,
										}));
									}}
								/>
							</div>
						</div>
						<div className="admin-form-row">
							<div className="admin-form-field">
								<label htmlFor="collection-edit-description">
									{m.collection_description()}
								</label>
								<textarea
									id="collection-edit-description"
									rows={5}
									value={editForm.description}
									onChange={(event) => {
										const value = event.currentTarget.value;
										setEditForm((current) => ({
											...current,
											description: value,
										}));
									}}
									required
								/>
							</div>
							{canCurate && (
								<div className="admin-form-field">
									<label htmlFor="collection-edit-status">
										{m.my_resources_status_legend()}
									</label>
									<select
										id="collection-edit-status"
										value={editForm.editorialStatus}
										onChange={(event) => {
											const value = event.currentTarget.value;
											setEditForm((current) => ({
												...current,
												editorialStatus: value,
											}));
										}}
									>
										{Object.entries(STATUS_LABELS).map(([value, label]) => (
											<option key={value} value={value}>
												{label()}
											</option>
										))}
									</select>
								</div>
							)}
						</div>
						<div className="admin-form-row admin-form-row--full">
							<label
								className="admin-form-check"
								htmlFor="collection-edit-ordered"
							>
								<input
									id="collection-edit-ordered"
									type="checkbox"
									checked={editForm.isOrdered}
									onChange={(event) => {
										const checked = event.currentTarget.checked;
										setEditForm((current) => ({
											...current,
											isOrdered: checked,
										}));
									}}
								/>
								{m.collection_ordered()}
							</label>
						</div>

						<section
							className="collection-resource-section"
							aria-labelledby="collection-resources-title"
						>
							<h3
								id="collection-resources-title"
								className="collection-resource-section-title"
							>
								{m.collection_resources()}
							</h3>
							<p className="collection-resource-section-copy">
								{m.collection_resources_hint()}
							</p>

							<div className="admin-toolbar collection-resource-toolbar">
								<label className="admin-toolbar-field collection-resource-search">
									<span className="admin-toolbar-label">
										{m.nav_search_label()}
									</span>
									<input
										type="search"
										placeholder={m.collection_resource_search_placeholder()}
										value={resourceSearch}
										onChange={(event) =>
											setResourceSearch(event.currentTarget.value)
										}
										onKeyDown={(event) => {
											if (event.key === "Enter") {
												event.preventDefault();
												void searchResources(editing.id, resourceSearch.trim());
											}
										}}
									/>
								</label>
								<button
									type="button"
									className="admin-btn"
									onClick={() =>
										void searchResources(editing.id, resourceSearch.trim())
									}
									disabled={busyAction === "resource-search"}
								>
									{m.common_search()}
								</button>
							</div>

							<div className="admin-table-wrap collection-resource-table-wrap">
								<div className="admin-table-overflow">
									<table className="admin-table">
										<thead>
											<tr>
												<th>{m.collection_position()}</th>
												<th>{m.collection_title()}</th>
												<th>{m.my_resources_status_legend()}</th>
												<th>{m.admin_reports_col_actions()}</th>
											</tr>
										</thead>
										<tbody>
											{collectionResources.length === 0 ? (
												<tr className="admin-empty-row">
													<td colSpan={4}>{m.collection_resources_empty()}</td>
												</tr>
											) : (
												collectionResources.map((item, index) => (
													<tr key={item.resourceId}>
														<td>{index + 1}</td>
														<td>
															<strong>{item.title}</strong>
															<div>{truncate(item.description ?? "", 72)}</div>
														</td>
														<td>{statusLabel(item.editorialStatus)}</td>
														<td className="admin-actions-cell">
															<button
																type="button"
																className="admin-btn admin-btn--sm"
																disabled={
																	index === 0 ||
																	busyAction === "resource-reorder"
																}
																onClick={() =>
																	void handleReorder(item.resourceId, "up")
																}
															>
																{m.collection_move_up()}
															</button>
															<button
																type="button"
																className="admin-btn admin-btn--sm"
																disabled={
																	index === collectionResources.length - 1 ||
																	busyAction === "resource-reorder"
																}
																onClick={() =>
																	void handleReorder(item.resourceId, "down")
																}
															>
																{m.collection_move_down()}
															</button>
															<button
																type="button"
																className="admin-btn admin-btn--sm admin-btn--danger"
																disabled={busyAction === "resource-remove"}
																onClick={() =>
																	void handleRemoveResource(item.resourceId)
																}
															>
																{m.catalog_multiselect_remove_button()}
															</button>
														</td>
													</tr>
												))
											)}
										</tbody>
									</table>
								</div>
							</div>

							<div className="admin-table-wrap">
								<div className="admin-table-overflow">
									<table className="admin-table">
										<thead>
											<tr>
												<th>{m.collection_result()}</th>
												<th>{m.catalog_resource_type()}</th>
												<th>{m.admin_reports_col_actions()}</th>
											</tr>
										</thead>
										<tbody>
											{resourceResults.length === 0 ? (
												<tr className="admin-empty-row">
													<td colSpan={3}>{m.collection_search_resources()}</td>
												</tr>
											) : (
												resourceResults.map((item) => (
													<tr key={item.id}>
														<td>
															<strong>{item.title}</strong>
															<div>{truncate(item.description ?? "", 72)}</div>
														</td>
														<td>{item.resourceType}</td>
														<td className="admin-actions-cell">
															<button
																type="button"
																className="admin-btn admin-btn--sm admin-btn--primary"
																disabled={busyAction === "resource-add"}
																onClick={() => void handleAddResource(item.id)}
															>
																{m.collection_add_resource()}
															</button>
														</td>
													</tr>
												))
											)}
										</tbody>
									</table>
								</div>
							</div>
						</section>

						<AccessibleFeedback
							message={editError}
							variant="error"
							polite={false}
						/>
						<AccessibleFeedback
							message={resourceFeedback.message}
							variant={resourceFeedback.variant}
						/>

						<div className="admin-dialog-actions">
							<button
								type="button"
								className="admin-btn"
								onClick={() => {
									setEditing(null);
									setEditError("");
									setCollectionResources([]);
									setResourceResults([]);
								}}
								disabled={busyAction === "edit"}
							>
								{m.common_cancel()}
							</button>
							<button
								type="submit"
								className="admin-btn admin-btn--primary"
								disabled={busyAction === "edit"}
							>
								{busyAction === "edit" ? m.profile_saving() : m.common_save()}
							</button>
							{!canCurate &&
								user &&
								editing.editorialStatus !== "review" &&
								!collectionStatusChangeError(
									user,
									editing.editorialStatus,
									"review",
								) && (
									<button
										type="submit"
										value="review"
										className="admin-btn"
										disabled={busyAction === "edit"}
									>
										{m.resource_submit_review()}
									</button>
								)}
						</div>
					</form>
				</ModalFrame>
			) : null}

			<ConfirmDialog
				open={deleteTarget !== null}
				title="Eliminar coleccion"
				message={`Seguro que deseas eliminar "${deleteTarget?.title ?? "esta coleccion"}"?`}
				confirmLabel="Eliminar"
				busy={busyAction === "delete"}
				onCancel={() => setDeleteTarget(null)}
				onConfirm={() => void handleDelete()}
			/>
		</>
	);
}
