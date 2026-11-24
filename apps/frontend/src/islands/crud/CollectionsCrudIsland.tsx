import { VALID_LANGUAGES } from "@procomun/db/validation";
import {
	type Dispatch,
	type FormEvent,
	type SetStateAction,
	startTransition,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type {
	CatalogKeyword,
	CollectionRecord,
	CollectionResourceRecord,
	PublicKnowledgeAreaCatalog,
	Resource,
} from "../../lib/api-client.ts";
import {
	assignmentsToSelections,
	type EducationalSelection,
	selectionsToAssignments,
} from "../../lib/educational-classification.ts";
import { getApiClient } from "../../lib/get-api-client.ts";
import { labelFor } from "../../lib/labels.ts";
import { languageLabel } from "../../lib/resource-display.ts";
import { EducationalClassificationEditor } from "../resources/EducationalClassificationFields.tsx";
import { KeywordCatalogField } from "../resources/KeywordCatalogField.tsx";
import { KnowledgeAreaField } from "../resources/KnowledgeClassificationFields.tsx";
import { AccessibleFeedback } from "../shared/AccessibleFeedback.tsx";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import { ModalFrame } from "../shared/ModalFrame.tsx";
import { type CrudColumn, CrudTable } from "./CrudTable.tsx";

const PAGE_SIZE = 20;
const RESOURCE_SEARCH_LIMIT = 8;

const STATUS_LABELS: Record<string, string> = {
	draft: "Borrador",
	review: "En revision",
	published: "Publicado",
	archived: "Archivado",
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
	return labelFor(STATUS_LABELS, status, status);
}

function statusBadgeClass(status: string) {
	return STATUS_BADGES[status] ?? "";
}

function isOrderedValue(value: CollectionRecord["isOrdered"] | boolean) {
	return Boolean(value);
}

/** Campos de `current` que difieren de `loaded`: lo único que va en el PATCH (#623). */
export function changedFields<T extends Record<string, unknown>>(
	loaded: Partial<T>,
	current: T,
): Partial<T> {
	return Object.fromEntries(
		Object.entries(current).filter(
			([key, value]) => JSON.stringify(value) !== JSON.stringify(loaded[key]),
		),
	) as Partial<T>;
}

function coverPreview(url: string | null | undefined) {
	if (!url) return "Sin portada";
	return "Con portada";
}

export interface CollectionColumnHandlers {
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
			header: "Titulo",
			cell: (row) => (
				<div className="admin-collection-cell">
					<div className="admin-collection-title">{row.title}</div>
					<div className="admin-collection-meta">
						{row.curatorName ?? "Sin curator"}
					</div>
				</div>
			),
		},
		{
			id: "status",
			header: "Estado",
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
			header: "Descripcion",
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
			header: "Portada",
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
			header: "Recursos",
			cell: (row) => (
				<span className="admin-collection-meta">
					{String(row.resourceCount ?? 0)}
				</span>
			),
		},
		{
			id: "updatedAt",
			header: "Actualizado",
			cell: (row) => (
				<span className="admin-collection-meta">
					{formatDate(row.updatedAt)}
				</span>
			),
		},
		{
			id: "actions",
			header: "Acciones",
			className: "admin-actions-cell",
			cell: (row) => (
				<div className="admin-actions-cell">
					<button
						type="button"
						className="admin-action-btn admin-action-btn--edit"
						disabled={handlers.busyLoadEdit}
						onClick={() => handlers.onEdit(row.id)}
						aria-label={`Editar ${row.title}`}
					>
						<span className="material-symbols-outlined" aria-hidden="true">
							edit
						</span>
					</button>
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
				</div>
			),
		},
	];
}

type CollectionMetadata = {
	language: string;
	keywords: CatalogKeyword[];
	areas: string[];
	educational: EducationalSelection[];
};

const EMPTY_METADATA: CollectionMetadata = {
	language: "",
	keywords: [],
	areas: [],
	educational: [],
};

export function metadataPayload({
	language,
	keywords,
	areas,
	educational,
}: CollectionMetadata) {
	return {
		language: language || null,
		keywordIds: keywords.map(({ id }) => id),
		knowledgeAreaIds: areas,
		educationalAreas: selectionsToAssignments(educational),
	};
}

/** Cuerpo del PATCH de edición a partir de los valores del formulario. */
function editPayload(form: CollectionFormState, metadata: CollectionMetadata) {
	return {
		title: form.title,
		description: form.description,
		coverImageUrl: form.coverImageUrl || null,
		editorialStatus: form.editorialStatus,
		isOrdered: form.isOrdered,
		...metadataPayload(metadata),
	};
}

/** Mensaje que da la API al rechazar el alta (p. ej. un catálogo no válido). */
export function createErrorMessage(error: unknown): string {
	const { error: message, details } = (error ?? {}) as {
		error?: unknown;
		details?: unknown;
	};
	// `details` dice qué campo falla; `error` solo «Validación fallida».
	const reasons = Array.isArray(details)
		? details
				.map((detail) => (detail as { message?: unknown } | null)?.message)
				.filter((reason) => typeof reason === "string" && reason)
		: [];
	if (reasons.length) return reasons.join(" ");
	return typeof message === "string" && message
		? message
		: "Error al crear la coleccion.";
}

function CollectionMetadataFields({
	idPrefix,
	metadata,
	setMetadata,
	catalog,
	resourceAreas,
	onCatalogRetry,
}: {
	idPrefix: string;
	metadata: CollectionMetadata;
	setMetadata: Dispatch<SetStateAction<CollectionMetadata>>;
	catalog: PublicKnowledgeAreaCatalog | null;
	resourceAreas?: CollectionRecord["knowledgeAreas"];
	onCatalogRetry?: () => void;
}) {
	const { language, keywords, areas, educational } = metadata;
	return (
		<fieldset className="admin-form-field">
			<legend>Detalles técnicos</legend>
			<label htmlFor={`${idPrefix}-language`}>Idioma</label>
			<select
				id={`${idPrefix}-language`}
				value={language}
				onChange={(event) => {
					const { value } = event.currentTarget;
					setMetadata((current) => ({ ...current, language: value }));
				}}
			>
				<option value="">Sin indicar</option>
				{VALID_LANGUAGES.map((code) => (
					<option key={code} value={code}>
						{languageLabel(code)}
					</option>
				))}
			</select>
			<KeywordCatalogField
				id={`${idPrefix}-keywords`}
				selected={keywords}
				onChange={(keywords) =>
					setMetadata((current) => ({ ...current, keywords }))
				}
			/>
			<KnowledgeAreaField
				idPrefix={idPrefix}
				catalog={catalog}
				selectedIds={areas}
				onChange={(areas) => setMetadata((current) => ({ ...current, areas }))}
				resourceAreas={resourceAreas}
				onCatalogRetry={onCatalogRetry}
			/>
			<EducationalClassificationEditor
				idPrefix={idPrefix}
				selections={educational}
				onChange={(educational) =>
					setMetadata((current) => ({ ...current, educational }))
				}
			/>
		</fieldset>
	);
}

export function CollectionsCrudIsland() {
	const [rows, setRows] = useState<CollectionRecord[]>([]);
	const [search, setSearch] = useState("");
	const [appliedSearch, setAppliedSearch] = useState("");
	const [offset, setOffset] = useState(0);
	const [total, setTotal] = useState(0);
	const [statusMessage, setStatusMessage] = useState("Cargando colecciones...");
	const [createForm, setCreateForm] = useState(EMPTY_FORM);
	const [createFeedback, setCreateFeedback] = useState<{
		message: string;
		variant: "neutral" | "success" | "error";
	}>({
		message: "",
		variant: "neutral",
	});
	const [createMetadata, setCreateMetadata] = useState(EMPTY_METADATA);
	const [editMetadata, setEditMetadata] = useState(EMPTY_METADATA);
	const [catalog, setCatalog] = useState<PublicKnowledgeAreaCatalog | null>(
		null,
	);
	const [catalogFailed, setCatalogFailed] = useState(false);
	// Cambia tras cada alta: los buscadores del formulario vuelven a montarse
	// y no arrastran el texto ni los avisos de la colección anterior.
	const [createFormKey, setCreateFormKey] = useState(0);

	const [editing, setEditing] = useState<CollectionRecord | null>(null);
	const [editForm, setEditForm] = useState(EMPTY_FORM);
	const [editError, setEditError] = useState("");
	// Lo que se cargó al abrir la edición: el PATCH lleva solo las diferencias.
	const loadedPayload = useRef<ReturnType<typeof editPayload> | null>(null);
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
			setStatusMessage("Cargando colecciones...");

			try {
				const api = await getApiClient();
				const result = await api.listCollections({
					q: nextSearch || undefined,
					limit: PAGE_SIZE,
					offset: nextOffset,
				});

				startTransition(() => {
					setRows(result.data);
					setOffset(result.offset);
					setTotal(result.total);
					setStatusMessage(`${result.total} colecciones encontradas`);
				});
			} catch {
				setRows([]);
				setTotal(0);
				setStatusMessage("No se pudieron cargar las colecciones.");
			}
		},
		[],
	);

	async function loadCollectionResources(collectionId: string) {
		const api = await getApiClient();
		const items = await api.listCollectionResources(collectionId);
		setCollectionResources(items);
	}

	async function searchResources(collectionId: string, query: string) {
		setBusyAction("resource-search");
		setResourceFeedback({ message: "", variant: "neutral" });
		try {
			const api = await getApiClient();
			const result = await api.listAdminResources({
				q: query || undefined,
				limit: RESOURCE_SEARCH_LIMIT,
				offset: 0,
			});
			const currentIds = new Set(
				collectionResources.map((item) => item.resourceId),
			);
			setResourceResults(
				result.data.filter(
					(item) => item.id !== collectionId && !currentIds.has(item.id),
				),
			);
		} catch {
			setResourceResults([]);
			setResourceFeedback({
				message: "No se pudo buscar recursos.",
				variant: "error",
			});
		} finally {
			setBusyAction(null);
		}
	}

	// El aviso sigue a la vista mientras se reintenta y solo se quita al
	// cargar: así el botón no desaparece bajo el foco.
	const loadCatalog = useCallback(() => {
		void getApiClient()
			.then((api) => api.getKnowledgeAreaCatalog())
			.then((loaded) => {
				setCatalog(loaded);
				setCatalogFailed(false);
			})
			.catch(() => setCatalogFailed(true));
	}, []);

	useEffect(() => {
		void loadCollections(0, "");
		loadCatalog();
	}, [loadCollections, loadCatalog]);

	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

	const columns = buildCollectionColumns({
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
			if (!collection) {
				setStatusMessage("No se pudo cargar la coleccion seleccionada.");
				return;
			}

			const form = {
				title: collection.title,
				description: collection.description,
				coverImageUrl: collection.coverImageUrl ?? "",
				editorialStatus: collection.editorialStatus,
				isOrdered: isOrderedValue(collection.isOrdered),
			};
			const metadata = {
				language: collection.language ?? "",
				keywords: collection.catalogKeywords ?? [],
				areas: collection.knowledgeAreas?.map(({ id }) => id) ?? [],
				educational: assignmentsToSelections(collection.educationalAreas ?? []),
			};
			loadedPayload.current = editPayload(form, metadata);
			setEditMetadata(metadata);
			setEditing(collection);
			// Si el catálogo no cargó al montar, se reintenta al abrir la edición.
			if (!catalog) loadCatalog();
			setEditForm(form);
			await loadCollectionResources(collection.id);
		} catch {
			setStatusMessage("No se pudo cargar la coleccion seleccionada.");
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
				...metadataPayload(createMetadata),
			});
			setCreateForm(EMPTY_FORM);
			setCreateMetadata(EMPTY_METADATA);
			setCreateFormKey((key) => key + 1);
			setCreateFeedback({ message: "Coleccion creada.", variant: "success" });
			await loadCollections(0, appliedSearch);
		} catch (error) {
			setCreateFeedback({
				message: createErrorMessage(error),
				variant: "error",
			});
		} finally {
			setBusyAction(null);
		}
	}

	async function handleEditSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!editing) return;

		setBusyAction("edit");
		setEditError("");

		try {
			const api = await getApiClient();
			// #623: solo se envía lo que ha cambiado, para no pisar lo que otra
			// pestaña haya guardado mientras tanto.
			const result = await api.updateCollection(
				editing.id,
				changedFields(
					loadedPayload.current ?? {},
					editPayload(editForm, editMetadata),
				),
			);
			if (!result.ok) {
				setEditError(result.error ?? "Error al guardar.");
				return;
			}

			setEditing(null);
			setCollectionResources([]);
			setResourceResults([]);
			await loadCollections(offset, appliedSearch);
		} catch {
			setEditError("Error de conexion.");
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
			await loadCollectionResources(editing.id);
			await searchResources(editing.id, resourceSearch.trim());
			setResourceFeedback({
				message: "Recurso añadido a la colección.",
				variant: "success",
			});
		} catch {
			setResourceFeedback({
				message: "No se pudo añadir el recurso.",
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
			await loadCollectionResources(editing.id);
			await searchResources(editing.id, resourceSearch.trim());
			setResourceFeedback({
				message: "Recurso eliminado de la colección.",
				variant: "success",
			});
		} catch {
			setResourceFeedback({
				message: "No se pudo eliminar el recurso.",
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
					message: result.error ?? "No se pudo reordenar.",
					variant: "error",
				});
				return;
			}
			await loadCollectionResources(editing.id);
		} finally {
			setBusyAction(null);
		}
	}

	return (
		<>
			<section className="admin-inline-form">
				<h3>Nueva coleccion</h3>
				<form onSubmit={handleCreate}>
					<div className="admin-form-row">
						<div className="admin-form-field">
							<label htmlFor="collection-create-title">Titulo</label>
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
							<label htmlFor="collection-create-cover">URL de portada</label>
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
							<label htmlFor="collection-create-description">Descripcion</label>
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
							Orden fija
						</label>
					</div>
					<CollectionMetadataFields
						key={createFormKey}
						idPrefix="collection-create"
						metadata={createMetadata}
						setMetadata={setCreateMetadata}
						catalog={catalog}
						onCatalogRetry={catalogFailed && !catalog ? loadCatalog : undefined}
					/>
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

			<section className="admin-toolbar">
				<label className="admin-toolbar-field">
					<span className="admin-toolbar-label">Busqueda</span>
					<input
						type="search"
						placeholder="Titulo o descripcion"
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
					Aplicar
				</button>
			</section>

			<div className="admin-list-status" aria-live="polite">
				{statusMessage}
			</div>

			<CrudTable
				columns={columns}
				rows={rows}
				getRowKey={(row) => row.id}
				emptyMessage="No hay colecciones para los filtros actuales."
			/>

			<div className="admin-pager" hidden={total <= PAGE_SIZE}>
				<button
					type="button"
					onClick={() =>
						void loadCollections(Math.max(0, offset - PAGE_SIZE), appliedSearch)
					}
					disabled={offset === 0}
				>
					Anterior
				</button>
				<span className="admin-pager-label">
					{`Pagina ${currentPage} de ${totalPages}`}
				</span>
				<button
					type="button"
					onClick={() =>
						void loadCollections(offset + PAGE_SIZE, appliedSearch)
					}
					disabled={offset + PAGE_SIZE >= total}
				>
					Siguiente
				</button>
			</div>

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
					<h2 id="edit-collection-title">Editar coleccion</h2>
					<form onSubmit={handleEditSubmit}>
						<div className="admin-form-row">
							<div className="admin-form-field">
								<label htmlFor="collection-edit-title">Titulo</label>
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
								<label htmlFor="collection-edit-cover">URL de portada</label>
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
								<label htmlFor="collection-edit-description">Descripcion</label>
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
							<div className="admin-form-field">
								<label htmlFor="collection-edit-status">Estado</label>
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
									<option value="draft">Borrador</option>
									<option value="review">En revision</option>
									<option value="published">Publicado</option>
									<option value="archived">Archivado</option>
								</select>
							</div>
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
								Orden fija
							</label>
						</div>

						<CollectionMetadataFields
							idPrefix="collection-edit"
							metadata={editMetadata}
							setMetadata={setEditMetadata}
							catalog={catalog}
							onCatalogRetry={
								catalogFailed && !catalog ? loadCatalog : undefined
							}
							resourceAreas={editing.knowledgeAreas}
						/>

						<section
							className="collection-resource-section"
							aria-labelledby="collection-resources-title"
						>
							<h3
								id="collection-resources-title"
								className="collection-resource-section-title"
							>
								Recursos de la colección
							</h3>
							<p className="collection-resource-section-copy">
								Añade recursos existentes y reordénalos con flechas.
							</p>

							<div className="admin-toolbar collection-resource-toolbar">
								<label className="admin-toolbar-field collection-resource-search">
									<span className="admin-toolbar-label">Buscar recursos</span>
									<input
										type="search"
										placeholder="Titulo del recurso"
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
									Buscar
								</button>
							</div>

							<div className="admin-table-wrap collection-resource-table-wrap">
								<div className="admin-table-overflow">
									<table className="admin-table">
										<thead>
											<tr>
												<th>Pos.</th>
												<th>Titulo</th>
												<th>Estado</th>
												<th>Acciones</th>
											</tr>
										</thead>
										<tbody>
											{collectionResources.length === 0 ? (
												<tr className="admin-empty-row">
													<td colSpan={4}>
														La colección todavía no tiene recursos asociados.
													</td>
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
																Subir
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
																Bajar
															</button>
															<button
																type="button"
																className="admin-btn admin-btn--sm admin-btn--danger"
																disabled={busyAction === "resource-remove"}
																onClick={() =>
																	void handleRemoveResource(item.resourceId)
																}
															>
																Quitar
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
												<th>Resultado</th>
												<th>Tipo</th>
												<th>Acción</th>
											</tr>
										</thead>
										<tbody>
											{resourceResults.length === 0 ? (
												<tr className="admin-empty-row">
													<td colSpan={3}>
														Busca recursos para añadirlos a la colección.
													</td>
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
																Añadir
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
								id="edit-cancel"
								className="admin-btn"
								onClick={() => {
									setEditing(null);
									setEditError("");
									setCollectionResources([]);
									setResourceResults([]);
								}}
								disabled={busyAction === "edit"}
							>
								Cancelar
							</button>
							<button
								type="submit"
								className="admin-btn admin-btn--primary"
								disabled={busyAction === "edit"}
							>
								{busyAction === "edit" ? "Guardando..." : "Guardar"}
							</button>
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
