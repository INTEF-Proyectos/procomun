import { canManageResource } from "@procomun/db/validation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
	BadgeConfig,
	PublicKnowledgeAreaCatalog,
	Resource,
	ResourceStatusCounts,
} from "../../lib/api-client.ts";
import { getApiClient } from "../../lib/get-api-client.ts";
import { familyFilterFor } from "../../lib/knowledge-area-field.ts";
import { getPaginationState } from "../../lib/pagination.ts";
import { url } from "../../lib/paths.ts";
import {
	type FilterOption,
	loadFilterOptions,
	RESOURCE_TYPE_OPTIONS,
} from "../../lib/resource-filters.ts";
import { computeResourceBadges } from "../../lib/shared-utils.ts";
import { EmptyState } from "../../ui/EmptyState.tsx";
import { Pagination } from "../../ui/Pagination.tsx";
import { ResourceCard } from "../../ui/ResourceCard.tsx";
import { ResourceGrid } from "../../ui/ResourceGrid.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import { EducationalSearchFilters } from "../catalog/EducationalSearchFilters.tsx";
import { KnowledgeAreaSearchFilters } from "../catalog/KnowledgeAreaSearchFilters.tsx";
import { KeywordCatalogField } from "../resources/KeywordCatalogField.tsx";
import { ConfirmDialog } from "../shared/ConfirmDialog.tsx";
import {
	EMPTY_MY_RESOURCES_FILTERS,
	EMPTY_STATUS_COUNTS,
	hasActiveFilters,
	MY_RESOURCES_PAGE_SIZE,
	type MyResourcesFilters,
	type MyResourcesStatus,
	myResourcesRequest,
	pageAfterDelete,
	pageOutOfRange,
} from "./my-resources.ts";
import "./MyResourcesTab.css";
import "../../lib/paraglide-client.ts";
import * as m from "../../paraglide/messages.js";

export interface StatusFilterOption {
	value: MyResourcesStatus;
	label: string;
	count: number;
}

/** Opciones del filtro de estado con los contadores de la API. */
export function statusFilterOptions(
	counts: ResourceStatusCounts,
): StatusFilterOption[] {
	return [
		{
			value: "",
			count: counts.total,
			label: m.my_resources_status_all({ count: String(counts.total) }),
		},
		{
			value: "published",
			count: counts.published,
			label: m.my_resources_status_published({
				count: String(counts.published),
			}),
		},
		{
			value: "draft",
			count: counts.draft,
			label: m.my_resources_status_draft({ count: String(counts.draft) }),
		},
		{
			value: "review",
			count: counts.review,
			label: m.my_resources_status_review({ count: String(counts.review) }),
		},
		{
			value: "archived",
			count: counts.archived,
			label: m.my_resources_status_archived({
				count: String(counts.archived),
			}),
		},
	];
}

/** Insignia del estado en la tarjeta. Lo publicado no la necesita. */
export function statusBadge(
	status: string | undefined,
): { text: string; variant: "draft" | "review" | "tertiary" } | null {
	switch (status) {
		case "draft":
			return { text: m.resource_draft(), variant: "draft" };
		case "review":
			return { text: m.resource_in_review(), variant: "review" };
		case "archived":
			return { text: m.resource_archived(), variant: "tertiary" };
		default:
			return null;
	}
}

/** Quien ve el panel: decide si una tarjeta ofrece editar y eliminar. */
export interface MyResourcesUser {
	id: string;
	role?: string | null;
}

export interface MyResourcesViewProps {
	user: MyResourcesUser;
	filters: MyResourcesFilters;
	searchText: string;
	resources: Resource[];
	total: number;
	page: number;
	statusCounts: ResourceStatusCounts;
	loading: boolean;
	error: string;
	notice: string;
	badgeConfig: BadgeConfig;
	areaCatalog: PublicKnowledgeAreaCatalog | null;
	resourceTypeOptions: FilterOption[];
	noticeRef?: React.Ref<HTMLParagraphElement>;
	onSearchTextChange: (text: string) => void;
	onFiltersChange: (next: MyResourcesFilters) => void;
	onPageChange: (page: number) => void;
	onDelete: (resource: Resource) => void;
}

/**
 * «Mis recursos» del perfil (#530): todos los recursos propios, en cualquier
 * estado, con buscador, filtros, paginación y editar o eliminar en la tarjeta.
 */
export function MyResourcesView({
	user,
	filters,
	searchText,
	resources,
	total,
	page,
	statusCounts,
	loading,
	error,
	notice,
	badgeConfig,
	areaCatalog,
	resourceTypeOptions,
	noticeRef,
	onSearchTextChange,
	onFiltersChange,
	onPageChange,
	onDelete,
}: MyResourcesViewProps) {
	const searchId = useId();
	const typeId = useId();
	const summaryRef = useRef<HTMLElement>(null);
	const pagination = getPaginationState(
		total,
		MY_RESOURCES_PAGE_SIZE,
		(page - 1) * MY_RESOURCES_PAGE_SIZE,
	);
	const filtering = hasActiveFilters(filters);
	// Abierto al montar si ya hay filtros; luego lo decide quien lo usa. Si
	// dependiera de `filtering`, al limpiar se cerraría con el foco dentro.
	const [filtersOpenOnMount] = useState(filtering);

	function change(next: Partial<MyResourcesFilters>) {
		// Lo escrito y aún sin aplicar por el retardo también cuenta.
		onFiltersChange({ ...filters, query: searchText, ...next });
	}

	// Región del aviso y del resumen. También en la vista vacía: tras borrar el
	// último recurso el aviso tiene que seguir montado para recibir el foco.
	const summary = (
		<p
			ref={noticeRef}
			className="my-resources-summary"
			role="status"
			tabIndex={-1}
		>
			{notice ? <span className="my-resources-notice">{notice} </span> : null}
			{loading
				? m.catalog_searching()
				: error
					? null
					: total > 0
						? m.my_resources_showing({
								start: String(pagination.startItem),
								end: String(pagination.endItem),
								total: String(total),
							})
						: null}
		</p>
	);

	// Sin ningún recurso propio no hay nada que filtrar: se invita a crear.
	if (!loading && !error && statusCounts.total === 0 && !filtering) {
		return (
			<>
				{notice ? summary : null}
				<EmptyState
					icon="note_add"
					title={m.profile_no_resources()}
					description={m.profile_no_resources_desc()}
					action={
						<a href={url("nuevo")} className="dashboard-create-btn">
							{m.profile_create_resource()}
						</a>
					}
				/>
			</>
		);
	}

	return (
		<div className="my-resources">
			<search className="my-resources-search">
				<label htmlFor={searchId} className="my-resources-label">
					{m.my_resources_search_label()}
				</label>
				<input
					id={searchId}
					type="search"
					className="my-resources-input"
					placeholder={m.my_resources_search_placeholder()}
					value={searchText}
					onChange={(event) => onSearchTextChange(event.currentTarget.value)}
				/>
			</search>

			<fieldset className="my-resources-status">
				<legend className="my-resources-label">
					{m.my_resources_status_legend()}
				</legend>
				<div className="my-resources-status-options">
					{statusFilterOptions(statusCounts).map((option) => (
						<label
							key={option.value || "all"}
							className="my-resources-status-option"
						>
							<input
								type="radio"
								name="my-resources-status"
								value={option.value}
								checked={filters.status === option.value}
								onChange={() => change({ status: option.value })}
							/>
							<span>{option.label}</span>
						</label>
					))}
				</div>
			</fieldset>

			<details
				className="my-resources-filters"
				open={filtersOpenOnMount || undefined}
			>
				<summary ref={summaryRef}>{m.my_resources_filters()}</summary>
				<div className="my-resources-filters-body">
					<div className="filter-group">
						<label htmlFor={typeId}>{m.catalog_resource_type()}</label>
						<select
							id={typeId}
							value={filters.resourceType}
							onChange={(event) =>
								change({ resourceType: event.currentTarget.value })
							}
						>
							{resourceTypeOptions.map((option) => (
								<option key={option.value || "all"} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</div>
					<EducationalSearchFilters
						categoryId={filters.educationalCategory}
						optionId={filters.educationalOption}
						onChange={(next) =>
							change({
								educationalCategory: next.categoryId,
								educationalOption: next.optionId,
								professionalFamilies: familyFilterFor(
									next.categoryId,
									filters.professionalFamilies,
								),
							})
						}
					/>
					<KnowledgeAreaSearchFilters
						catalog={areaCatalog}
						educationalCategory={filters.educationalCategory}
						knowledgeAreas={filters.knowledgeAreas}
						professionalFamilies={filters.professionalFamilies}
						onChange={(next) => change(next)}
					/>
					<div className="filter-group">
						<KeywordCatalogField
							id="my-resources-tag"
							filter
							selected={
								filters.tag
									? [
											{
												id: filters.tag,
												slug: filters.tag,
												label: filters.tagLabel || filters.tag,
											},
										]
									: []
							}
							onChange={(next) => {
								// Un solo valor, como en el buscador: la última sustituye.
								const keyword = next.at(-1);
								change({
									tag: keyword?.slug ?? "",
									tagLabel: keyword?.label ?? "",
								});
							}}
						/>
					</div>
					{filtering ? (
						<button
							type="button"
							className="my-resources-clear"
							onClick={() => {
								// El botón se desmonta al limpiar: el foco pasa antes al
								// encabezado del panel, que sigue abierto y montado.
								summaryRef.current?.focus();
								onFiltersChange({
									...EMPTY_MY_RESOURCES_FILTERS,
									status: filters.status,
								});
							}}
						>
							{m.catalog_clear_filters()}
						</button>
					) : null}
				</div>
			</details>

			{summary}

			{error ? (
				<p className="my-resources-error" role="alert">
					{error}
				</p>
			) : null}

			{loading ? (
				<Skeleton lines={3} />
			) : !error && resources.length === 0 ? (
				<EmptyState
					icon="search_off"
					title={m.my_resources_none_found()}
					description={m.my_resources_none_found_desc()}
				/>
			) : (
				<ResourceGrid>
					{resources.map((resource) => {
						const badge = statusBadge(resource.editorialStatus);
						const manageable = canManageResource(
							{ id: user.id, role: user.role ?? undefined },
							resource,
						);
						return (
							<div key={resource.id} className="my-resources-card">
								<ResourceCard
									resource={{
										...resource,
										author: resource.createdByName || resource.author || null,
										createdAt:
											typeof resource.createdAt === "string"
												? resource.createdAt
												: "",
									}}
									href={url(`recurso?slug=${resource.slug}`)}
									badges={[
										...computeResourceBadges(resource, badgeConfig),
										...(badge ? [badge] : []),
									]}
								/>
								{manageable ? (
									<div className="my-resources-card-actions">
										<a
											href={url(`editar?id=${resource.id}`)}
											className="my-resources-action"
											aria-label={m.profile_edit_resource({
												title: resource.title,
											})}
										>
											<span
												className="material-symbols-outlined"
												aria-hidden="true"
											>
												edit
											</span>
											{m.my_resources_edit()}
										</a>
										<button
											type="button"
											className="my-resources-action my-resources-action-danger"
											aria-haspopup="dialog"
											aria-label={m.common_delete_label({
												label: resource.title,
											})}
											onClick={() => onDelete(resource)}
										>
											<span
												className="material-symbols-outlined"
												aria-hidden="true"
											>
												delete
											</span>
											{m.my_resources_delete()}
										</button>
									</div>
								) : null}
							</div>
						);
					})}
				</ResourceGrid>
			)}

			<Pagination
				currentPage={pagination.currentPage}
				totalPages={pagination.totalPages}
				onPageChange={onPageChange}
			/>
		</div>
	);
}

interface MyResourcesTabProps {
	user: MyResourcesUser;
	badgeConfig: BadgeConfig;
	/** Tras borrar: el perfil vuelve a pedir sus contadores. */
	onChanged?: () => void;
}

export function MyResourcesTab({
	user,
	badgeConfig,
	onChanged,
}: MyResourcesTabProps) {
	const [filters, setFilters] = useState<MyResourcesFilters>(
		EMPTY_MY_RESOURCES_FILTERS,
	);
	const [searchText, setSearchText] = useState("");
	const [page, setPage] = useState(1);
	const [resources, setResources] = useState<Resource[]>([]);
	const [total, setTotal] = useState(0);
	const [statusCounts, setStatusCounts] =
		useState<ResourceStatusCounts>(EMPTY_STATUS_COUNTS);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");
	const [reloadKey, setReloadKey] = useState(0);
	const [pendingDelete, setPendingDelete] = useState<Resource | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [resourceTypeOptions, setResourceTypeOptions] = useState<
		FilterOption[]
	>(RESOURCE_TYPE_OPTIONS);
	const [areaCatalog, setAreaCatalog] =
		useState<PublicKnowledgeAreaCatalog | null>(null);
	const requestIdRef = useRef(0);
	const noticeRef = useRef<HTMLParagraphElement>(null);
	const focusNoticeRef = useRef(false);

	useEffect(() => {
		void loadFilterOptions(
			"resource-type",
			m.catalog_all_types(),
			RESOURCE_TYPE_OPTIONS,
		).then(setResourceTypeOptions);
		void getApiClient()
			.then((api) => api.getKnowledgeAreaCatalog())
			.then(setAreaCatalog)
			.catch(() => {});
	}, []);

	// El texto se aplica 300 ms después de dejar de escribir, como el buscador.
	useEffect(() => {
		if (searchText === filters.query) return;
		const handle = setTimeout(() => {
			setFilters((prev) => ({ ...prev, query: searchText }));
			setPage(1);
		}, 300);
		return () => clearTimeout(handle);
	}, [searchText, filters.query]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reloadKey fuerza la recarga tras borrar.
	useEffect(() => {
		const requestId = requestIdRef.current + 1;
		requestIdRef.current = requestId;
		setLoading(true);
		setError("");
		void (async () => {
			try {
				const api = await getApiClient();
				const result = await api.listMyResources(
					myResourcesRequest(filters, page),
				);
				if (requestId !== requestIdRef.current) return;
				const inRange = pageOutOfRange(page, result.data.length, result.total);
				if (inRange !== null) {
					setPage(inRange);
					return;
				}
				setResources(result.data);
				setTotal(result.total);
				setStatusCounts(result.statusCounts ?? EMPTY_STATUS_COUNTS);
			} catch {
				if (requestId !== requestIdRef.current) return;
				setResources([]);
				setTotal(0);
				setError(m.my_resources_load_error());
			} finally {
				if (requestId === requestIdRef.current) setLoading(false);
			}
		})();
	}, [filters, page, reloadKey]);

	// Tras borrar, el botón desaparece: el foco va al aviso del resultado.
	useEffect(() => {
		if (!loading && focusNoticeRef.current) {
			focusNoticeRef.current = false;
			noticeRef.current?.focus();
		}
	}, [loading]);

	const closeDialog = useCallback(() => {
		if (!deleting) setPendingDelete(null);
	}, [deleting]);

	async function confirmDelete() {
		const target = pendingDelete;
		if (!target) return;
		setDeleting(true);
		try {
			const api = await getApiClient();
			await api.deleteResource(target.id);
			setNotice(m.my_resources_deleted({ title: target.title }));
			focusNoticeRef.current = true;
			setPage((current) => pageAfterDelete(current, resources.length));
			setReloadKey((key) => key + 1);
			onChanged?.();
		} catch {
			setNotice(m.my_resources_delete_error({ title: target.title }));
		} finally {
			setDeleting(false);
			setPendingDelete(null);
		}
	}

	return (
		<div className="dashboard-tab-content">
			<div className="dashboard-tab-header">
				<span>
					{m.profile_resources_count({ count: String(statusCounts.total) })}
				</span>
				<a href={url("nuevo")} className="dashboard-create-btn">
					<span className="material-symbols-outlined" aria-hidden="true">
						add
					</span>
					{m.profile_new_resource()}
				</a>
			</div>
			<MyResourcesView
				user={user}
				filters={filters}
				searchText={searchText}
				resources={resources}
				total={total}
				page={page}
				statusCounts={statusCounts}
				loading={loading}
				error={error}
				notice={notice}
				badgeConfig={badgeConfig}
				areaCatalog={areaCatalog}
				resourceTypeOptions={resourceTypeOptions}
				noticeRef={noticeRef}
				onSearchTextChange={(text) => {
					setNotice("");
					setSearchText(text);
				}}
				onFiltersChange={(next) => {
					setNotice("");
					// «Limpiar filtros» también vacía la caja de búsqueda, aunque lo
					// escrito no se haya aplicado aún.
					if (next.query !== searchText) setSearchText(next.query);
					setFilters(next);
					setPage(1);
				}}
				onPageChange={(next) => {
					setNotice("");
					setPage(next);
				}}
				onDelete={setPendingDelete}
			/>
			{pendingDelete &&
				createPortal(
					<ConfirmDialog
						open
						title={m.my_resources_delete_title()}
						message={m.my_resources_delete_confirm({
							title: pendingDelete.title,
						})}
						confirmLabel={m.my_resources_delete()}
						cancelLabel={m.common_cancel()}
						busyLabel={m.my_resources_deleting()}
						busy={deleting}
						onCancel={closeDialog}
						onConfirm={() => void confirmDelete()}
					/>,
					document.body,
				)}
		</div>
	);
}
