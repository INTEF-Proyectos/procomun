import {
	startTransition,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useIframeScale } from "../../hooks/use-iframe-scale.ts";
import type {
	BadgeConfig,
	PublicKnowledgeAreaCatalog,
	Resource,
} from "../../lib/api-client.ts";
import {
	CATALOG_QUERY_CHANGE_EVENT,
	type CatalogQueryDetail,
	dispatchCatalogQuerySync,
} from "../../lib/catalog-events.ts";
import { sanitizeEducationalFilter } from "../../lib/educational-classification.ts";
import { getApiClient } from "../../lib/get-api-client.ts";
import { familyFilterFor } from "../../lib/knowledge-area-field.ts";
import {
	buildListingUrl,
	type ListingState,
	readListingState,
	writeListingStateToHistory,
} from "../../lib/listing-history.ts";
import { DEFAULT_PAGE_SIZE, getPaginationState } from "../../lib/pagination.ts";
import { url } from "../../lib/paths.ts";
import { resourceCardMedia } from "../../lib/resource-card-media.ts";
import { TYPE_ICONS } from "../../lib/resource-display.ts";
import {
	type FilterOption,
	LANGUAGE_OPTIONS,
	LICENSE_OPTIONS,
	loadFilterOptions,
	RESOURCE_TYPE_OPTIONS,
} from "../../lib/resource-filters.ts";
import {
	computeResourceBadges,
	DEFAULT_BADGE_CONFIG,
} from "../../lib/shared-utils.ts";
import { ResourceByline } from "../../ui/AuthorLinks.tsx";
import { KeywordCatalogField } from "../resources/KeywordCatalogField.tsx";
import { EducationalSearchFilters } from "./EducationalSearchFilters.tsx";
import { KnowledgeAreaSearchFilters } from "./KnowledgeAreaSearchFilters.tsx";
import "../../lib/paraglide-client.ts";
import * as m from "../../paraglide/messages.js";

type ViewMode = "grid" | "list";
type SortMode = "relevance" | "recent";
type HistoryMode = "push" | "replace";

const DEFAULT_LISTING_STATE: ListingState = {
	query: "",
	page: 1,
	resourceType: "",
	language: "",
	license: "",
	tag: "",
	educationalCategory: "",
	educationalOption: "",
	knowledgeAreas: [],
	professionalFamilies: [],
};

function readCatalogListingState(search: string): ListingState {
	const state = readListingState(search);
	const educational = sanitizeEducationalFilter(
		state.educationalCategory,
		state.educationalOption,
	);
	return {
		...state,
		educationalCategory: educational.categoryId,
		educationalOption: educational.optionId,
		// #448: las familias solo con la etapa FP.
		professionalFamilies: familyFilterFor(
			educational.categoryId,
			state.professionalFamilies,
		),
	};
}

function getResourceIcon(type: string) {
	return TYPE_ICONS[type] ?? "📄";
}

function renderPaginationPages(
	currentPage: number,
	totalPages: number,
): Array<number | "..."> {
	const pages: Array<number | "..."> = [];

	for (let page = 1; page <= totalPages; page += 1) {
		if (
			page === 1 ||
			page === totalPages ||
			(page >= currentPage - 1 && page <= currentPage + 1)
		) {
			pages.push(page);
			continue;
		}

		if (pages[pages.length - 1] !== "...") {
			pages.push("...");
		}
	}

	return pages;
}

export function CatalogResourceCard({
	resource,
	initialFavorited = false,
	isLoggedIn = false,
	badges,
}: {
	resource: Resource;
	initialFavorited?: boolean;
	isLoggedIn?: boolean;
	badges?: { text: string; variant: "primary" | "tertiary" }[];
}) {
	const description = resource.description || "";
	const clipped =
		description.length > 140 ? `${description.slice(0, 140)}...` : description;
	const media = resourceCardMedia(resource);
	const hasPreview = media.kind !== "empty";
	const previewRef = useIframeScale<HTMLDivElement>({
		iframeWidth: 1200,
		iframeHeight: 675,
	});
	const authorInitial = (resource.createdByName || resource.author || "?")
		.charAt(0)
		.toUpperCase();
	const [bookmarked, setBookmarked] = useState(initialFavorited);
	const [copied, setCopied] = useState(false);

	// Sync when initialFavorited changes (loaded async)
	useEffect(() => {
		setBookmarked(initialFavorited);
	}, [initialFavorited]);

	const handleBookmark = useCallback(
		async (e: React.MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			if (!isLoggedIn) {
				window.location.href = url("login");
				return;
			}
			setBookmarked((prev) => !prev); // optimistic
			setFavCount((prev) => prev + (bookmarked ? -1 : 1)); // optimistic
			try {
				const api = await getApiClient();
				const result = await api.toggleFavorite(resource.slug);
				setBookmarked(result.favorited);
				setFavCount(result.count);
			} catch {
				setBookmarked((prev) => !prev); // rollback
				setFavCount((prev) => prev + (bookmarked ? 1 : -1)); // rollback
			}
		},
		[resource.slug, isLoggedIn, bookmarked],
	);

	const handleShare = useCallback(
		(e: React.MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();
			const resourceUrl = new URL(
				url(`recurso?slug=${resource.slug}`),
				window.location.origin,
			).href;
			navigator.clipboard.writeText(resourceUrl).then(() => {
				setCopied(true);
				setTimeout(() => setCopied(false), 2000);
			});
		},
		[resource.slug],
	);

	const [favCount, setFavCount] = useState(Number(resource.favoriteCount ?? 0));
	const rating = resource.rating;

	const badgeOverlay =
		badges && badges.length > 0 ? (
			<div className="card-badges">
				{badges.map((b) => (
					<span key={b.text} className={`card-badge card-badge-${b.variant}`}>
						{b.text}
					</span>
				))}
			</div>
		) : null;

	return (
		// #458: no es un enlace porque contiene el del autor; el del título se
		// estira para que toda la tarjeta siga siendo pulsable.
		<article className={`resource-card${hasPreview ? " has-preview" : ""}`}>
			{media.kind === "image" ? (
				<div className="card-preview">
					<img src={media.url} alt="" />
					{badgeOverlay}
				</div>
			) : media.kind === "preview" ? (
				<div className="card-preview" ref={previewRef}>
					<iframe
						src={media.url}
						loading="lazy"
						tabIndex={-1}
						sandbox="allow-scripts"
						title={m.catalog_preview()}
					/>
					<div className="card-preview-overlay" />
					{badgeOverlay}
				</div>
			) : (
				<div
					className="card-preview"
					style={{
						background: `linear-gradient(135deg, var(--color-surface-container-low) 0%, var(--color-surface-container-high) 100%)`,
					}}
				>
					<div style={{ fontSize: "3rem", opacity: 0.4 }} aria-hidden="true">
						{getResourceIcon(resource.resourceType)}
					</div>
					{badgeOverlay}
				</div>
			)}
			<div className="card-body">
				<div className="card-tags">
					<span className="pill pill-type">{resource.resourceType}</span>
					<span className="pill pill-lang">
						{resource.language
							? `\u2022 ${(resource.language).toUpperCase()}`
							: ""}
					</span>
				</div>
				<h3>
					<a
						className="card-stretched-link"
						href={url(`recurso?slug=${resource.slug}`)}
					>
						{resource.title}
					</a>
				</h3>
				<p>{clipped}</p>
				<div className="card-footer">
					<div className="card-author">
						<div className="card-author-avatar" aria-hidden="true">
							{authorInitial}
						</div>
						<span className="card-author-name">
							<ResourceByline resource={resource} />
						</span>
					</div>
					<div className="card-actions card-over-link">
						{rating && rating.count > 0 && (
							<span className="card-rating">
								<span
									className="material-symbols-outlined card-rating-star"
									aria-hidden="true"
									style={{ fontVariationSettings: "'FILL' 1" }}
								>
									star
								</span>
								<span className="card-rating-value">
									{rating.average.toFixed(1)}
								</span>
							</span>
						)}
						<button
							className={`card-action-btn${bookmarked ? " card-action-active" : ""}`}
							aria-label={
								bookmarked
									? m.common_remove_favorite()
									: m.common_save_favorite()
							}
							aria-pressed={bookmarked}
							onClick={handleBookmark}
							type="button"
						>
							<span
								className="material-symbols-outlined"
								style={
									bookmarked ? { fontVariationSettings: "'FILL' 1" } : undefined
								}
							>
								bookmark
							</span>
							{favCount > 0 && (
								<span className="card-fav-count">{favCount}</span>
							)}
						</button>
						<button
							className={`card-action-btn${copied ? " card-action-copied" : ""}`}
							aria-label={
								copied ? m.common_link_copied() : m.common_copy_link()
							}
							onClick={handleShare}
							type="button"
						>
							<span className="material-symbols-outlined">
								{copied ? "check" : "share"}
							</span>
						</button>
					</div>
				</div>
			</div>
		</article>
	);
}

export function CatalogIsland() {
	const [listingState, setListingState] = useState<ListingState>(
		DEFAULT_LISTING_STATE,
	);
	const [viewMode, setViewMode] = useState<ViewMode>("grid");
	const [sortMode, setSortMode] = useState<SortMode>("relevance");
	const [resourceTypeOptions, setResourceTypeOptions] = useState<
		FilterOption[]
	>(RESOURCE_TYPE_OPTIONS);
	const [languageOptions, setLanguageOptions] =
		useState<FilterOption[]>(LANGUAGE_OPTIONS);
	const [licenseOptions, setLicenseOptions] =
		useState<FilterOption[]>(LICENSE_OPTIONS);
	const [tagLabel, setTagLabel] = useState("");
	const [resources, setResources] = useState<Resource[]>([]);
	const [total, setTotal] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [pagination, setPagination] = useState(() =>
		getPaginationState(0, DEFAULT_PAGE_SIZE, 0),
	);
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [favoritedSlugs, setFavoritedSlugs] = useState<Set<string>>(new Set());
	const [isLoggedIn, setIsLoggedIn] = useState(false);
	const [badgeConfig, setBadgeConfig] =
		useState<BadgeConfig>(DEFAULT_BADGE_CONFIG);
	const [areaCatalog, setAreaCatalog] =
		useState<PublicKnowledgeAreaCatalog | null>(null);
	const requestIdRef = useRef(0);
	const listingStateRef = useRef<ListingState>(DEFAULT_LISTING_STATE);

	useEffect(() => {
		listingStateRef.current = listingState;
	}, [listingState]);

	// Al recargar ?tag=<slug> se muestra la denominación, no el slug.
	useEffect(() => {
		const slug = listingState.tag;
		if (!slug) return;
		let cancelled = false;
		void getApiClient()
			.then((api) => api.getPublicTagBySlug(slug))
			.then((tag) => {
				if (!cancelled && tag) setTagLabel(tag.label);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [listingState.tag]);

	const loadResources = useCallback(
		async (nextState: ListingState, mode?: HistoryMode) => {
			const requestId = requestIdRef.current + 1;
			requestIdRef.current = requestId;
			setLoading(true);
			setError("");

			try {
				const api = await getApiClient();
				const offset = (nextState.page - 1) * DEFAULT_PAGE_SIZE;
				const educational = sanitizeEducationalFilter(
					nextState.educationalCategory,
					nextState.educationalOption,
				);
				const result = await api.listResources({
					q: nextState.query || undefined,
					limit: DEFAULT_PAGE_SIZE,
					offset,
					resourceType: nextState.resourceType || undefined,
					language: nextState.language || undefined,
					license: nextState.license || undefined,
					tag: nextState.tag || undefined,
					educationalCategory: educational.categoryId || undefined,
					educationalOption: educational.optionId || undefined,
					knowledgeAreas: nextState.knowledgeAreas,
					professionalFamilies: familyFilterFor(
						educational.categoryId,
						nextState.professionalFamilies,
					),
				});

				if (requestId !== requestIdRef.current) return;

				const paginationState = getPaginationState(
					result.total,
					result.limit,
					result.offset,
				);
				if (nextState.page > paginationState.totalPages) {
					const fixedState = { ...nextState, page: 1 };
					setListingState(fixedState);
					setSidebarOpen(false);
					await loadResources(fixedState, "replace");
					return;
				}

				startTransition(() => {
					setResources(result.data);
					setTotal(result.total);
					setPagination(paginationState);
					setLoading(false);
				});

				if (mode) {
					writeListingStateToHistory(
						window.history,
						buildListingUrl(
							window.location.pathname,
							window.location.search,
							nextState,
						),
						mode,
					);
				}
			} catch {
				if (requestId !== requestIdRef.current) return;
				setResources([]);
				setTotal(0);
				setPagination(getPaginationState(0, DEFAULT_PAGE_SIZE, 0));
				setError(m.catalog_error());
				setLoading(false);
			}
		},
		[],
	);

	const applyListingState = useCallback(
		async (
			nextState: ListingState,
			mode: HistoryMode,
			options?: { syncSearch?: boolean; scrollToTop?: boolean },
		) => {
			const syncSearch = options?.syncSearch ?? true;
			const scrollToTop = options?.scrollToTop ?? false;

			setListingState(nextState);
			setSidebarOpen(false);

			if (syncSearch) {
				dispatchCatalogQuerySync(nextState.query);
			}

			await loadResources(nextState, mode);

			if (scrollToTop) {
				window.scrollTo({ top: 0, behavior: "smooth" });
			}
		},
		[loadResources],
	);

	useEffect(() => {
		const nextViewMode =
			localStorage.getItem("catalog-view") === "list" ? "list" : "grid";
		const nextState = readCatalogListingState(window.location.search);
		setViewMode(nextViewMode);
		setListingState(nextState);
		listingStateRef.current = nextState;
		dispatchCatalogQuerySync(nextState.query);

		void Promise.all([
			loadFilterOptions(
				"resource-type",
				m.catalog_all_types(),
				RESOURCE_TYPE_OPTIONS,
			),
			loadFilterOptions(
				"language",
				m.catalog_all_languages(),
				LANGUAGE_OPTIONS,
			),
			loadFilterOptions("license", m.catalog_all_licenses(), LICENSE_OPTIONS),
		]).then(([types, languages, licenses]) => {
			setResourceTypeOptions(types);
			setLanguageOptions(languages);
			setLicenseOptions(licenses);
		});

		void loadResources(nextState);

		// Catálogo de áreas y familias para sus filtros (#448).
		void getApiClient()
			.then((api) => api.getKnowledgeAreaCatalog())
			.then(setAreaCatalog)
			.catch(() => {});

		// Load user session + favorites + badge config
		void (async () => {
			try {
				const api = await getApiClient();
				const [session, config] = await Promise.all([
					api.getSession().catch(() => null),
					api.getBadgeConfig().catch(() => null),
				]);
				if (config) setBadgeConfig(config);
				if (session?.user) {
					setIsLoggedIn(true);
					const favs = await api.getUserFavorites({ limit: 200 });
					setFavoritedSlugs(new Set(favs.data.map((r) => r.slug)));
				}
			} catch {
				// not logged in
			}
		})();

		function handlePopState() {
			const popState = readCatalogListingState(window.location.search);
			setListingState(popState);
			dispatchCatalogQuerySync(popState.query);
			void loadResources(popState);
		}

		function handleQueryChange(event: Event) {
			const customEvent = event as CustomEvent<CatalogQueryDetail>;
			const nextQuery = customEvent.detail?.query ?? "";
			void applyListingState(
				{ ...listingStateRef.current, query: nextQuery, page: 1 },
				"replace",
				{ syncSearch: false },
			);
		}

		window.addEventListener("popstate", handlePopState);
		window.addEventListener(
			CATALOG_QUERY_CHANGE_EVENT,
			handleQueryChange as EventListener,
		);

		return () => {
			window.removeEventListener("popstate", handlePopState);
			window.removeEventListener(
				CATALOG_QUERY_CHANGE_EVENT,
				handleQueryChange as EventListener,
			);
		};
	}, [loadResources, applyListingState]);

	function updateViewMode(nextViewMode: ViewMode) {
		setViewMode(nextViewMode);
		localStorage.setItem("catalog-view", nextViewMode);
	}

	function updateSortMode(nextSort: SortMode) {
		setSortMode(nextSort);
		// TODO: pass sort param to API when backend supports it
		void applyListingState({ ...listingState, page: 1 }, "replace");
	}

	const paginationPagesRaw = renderPaginationPages(
		pagination.currentPage,
		pagination.totalPages,
	);
	let previousPaginationPage = 0;
	const paginationPages = paginationPagesRaw.map((page) => {
		if (page === "...") {
			return { key: `ellipsis-after-${previousPaginationPage}`, value: page };
		}
		previousPaginationPage = page;
		return { key: `page-${page}`, value: page };
	});
	const resourcesClassName =
		viewMode === "list" ? "resources-list-view" : "resources-grid";

	/* Format total for display */
	const formattedTotal = total.toLocaleString();

	return (
		<div className="catalog">
			<aside className={`sidebar${sidebarOpen ? " open" : ""}`} id="sidebar">
				<h2 className="sidebar-title">{m.catalog_advanced_filters()}</h2>

				<EducationalSearchFilters
					categoryId={listingState.educationalCategory ?? ""}
					optionId={listingState.educationalOption ?? ""}
					onChange={(next) => {
						void applyListingState(
							{
								...listingState,
								educationalCategory: next.categoryId,
								educationalOption: next.optionId,
								// Al quitar FP se limpia el filtro de familias (#448).
								professionalFamilies: familyFilterFor(
									next.categoryId,
									listingState.professionalFamilies,
								),
								page: 1,
							},
							"replace",
						);
					}}
				/>

				<KnowledgeAreaSearchFilters
					catalog={areaCatalog}
					educationalCategory={listingState.educationalCategory ?? ""}
					knowledgeAreas={listingState.knowledgeAreas ?? []}
					professionalFamilies={listingState.professionalFamilies ?? []}
					onChange={(next) => {
						void applyListingState(
							{ ...listingState, ...next, page: 1 },
							"replace",
						);
					}}
				/>

				<div className="filter-group">
					<label htmlFor="filter-resource-type">
						{m.catalog_resource_type()}
					</label>
					<select
						id="filter-resource-type"
						value={listingState.resourceType}
						onChange={(event) => {
							void applyListingState(
								{
									...listingState,
									resourceType: event.currentTarget.value,
									page: 1,
								},
								"replace",
							);
						}}
					>
						{resourceTypeOptions.map((option) => (
							<option key={option.value || "all"} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</div>

				<div className="filter-group">
					<label htmlFor="filter-language">{m.catalog_language()}</label>
					<select
						id="filter-language"
						value={listingState.language}
						onChange={(event) => {
							void applyListingState(
								{
									...listingState,
									language: event.currentTarget.value,
									page: 1,
								},
								"replace",
							);
						}}
					>
						{languageOptions.map((option) => (
							<option key={option.value || "all"} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</div>

				<div className="filter-group">
					<label htmlFor="filter-license">{m.catalog_license()}</label>
					<select
						id="filter-license"
						value={listingState.license}
						onChange={(event) => {
							void applyListingState(
								{
									...listingState,
									license: event.currentTarget.value,
									page: 1,
								},
								"replace",
							);
						}}
					>
						{licenseOptions.map((option) => (
							<option key={option.value || "all"} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
				</div>

				<div className="filter-group">
					<KeywordCatalogField
						id="filter-tag"
						filter
						selected={
							listingState.tag
								? [
										{
											id: listingState.tag,
											slug: listingState.tag,
											label: tagLabel || listingState.tag,
										},
									]
								: []
						}
						onChange={(next) => {
							// Un solo valor: la última palabra elegida sustituye a la anterior.
							const keyword = next.at(-1);
							setTagLabel(keyword?.label ?? "");
							void applyListingState(
								{ ...listingState, tag: keyword?.slug ?? "", page: 1 },
								"replace",
							);
						}}
					/>
					{listingState.tag ? (
						<p className="filter-tag-link">
							<a href={url(`tags/${listingState.tag}`)}>
								Ver pagina de esta etiqueta
							</a>
						</p>
					) : null}
				</div>

				<button
					id="clear-filters"
					className="clear-btn"
					type="button"
					onClick={() => {
						void applyListingState(DEFAULT_LISTING_STATE, "replace");
					}}
				>
					{m.catalog_clear_filters()}
				</button>
			</aside>

			<section className="content" style={{ flexGrow: 1, minWidth: 0 }}>
				<div className="toolbar">
					<div className="toolbar-left">
						<button
							id="toggle-sidebar"
							className="toggle-sidebar-btn"
							type="button"
							onClick={() => setSidebarOpen((current) => !current)}
						>
							<span
								className="material-symbols-outlined"
								style={{ fontSize: "1.125rem" }}
							>
								filter_list
							</span>
							{m.catalog_filters()}
						</button>
						{listingState.query ? (
							<p className="results-summary-query" aria-live="polite">
								{m.catalog_results_for()} &ldquo;{listingState.query}&rdquo;
							</p>
						) : null}
						<h1 className="results-summary-count" aria-live="polite">
							{loading
								? m.catalog_searching()
								: error
									? m.catalog_no_results()
									: m.catalog_resources_count({ count: formattedTotal })}
						</h1>
					</div>
					<div className="toolbar-right">
						{/* View toggle: grid / list */}
						<div className="view-toggle">
							<button
								className={`view-toggle-btn${viewMode === "grid" ? " active" : ""}`}
								type="button"
								title={m.catalog_grid_view()}
								aria-label={m.catalog_grid_view()}
								onClick={() => updateViewMode("grid")}
							>
								<span className="material-symbols-outlined">grid_view</span>
							</button>
							<button
								className={`view-toggle-btn${viewMode === "list" ? " active" : ""}`}
								type="button"
								title={m.catalog_list_view()}
								aria-label={m.catalog_list_view()}
								onClick={() => updateViewMode("list")}
							>
								<span className="material-symbols-outlined">view_list</span>
							</button>
						</div>
						{/* Sort toggle: relevance / recent */}
						<span className="toolbar-sort-label">{m.catalog_sort_by()}</span>
						<div className="sort-toggle">
							<button
								className={`sort-toggle-btn${sortMode === "relevance" ? " active" : ""}`}
								type="button"
								onClick={() => updateSortMode("relevance")}
							>
								{m.catalog_sort_relevance()}
							</button>
							<button
								className={`sort-toggle-btn${sortMode === "recent" ? " active" : ""}`}
								type="button"
								onClick={() => updateSortMode("recent")}
							>
								{m.catalog_sort_recent()}
							</button>
						</div>
					</div>
				</div>

				<div className={resourcesClassName} aria-live="polite">
					{loading ? <p className="loading">{m.catalog_loading()}</p> : null}
					{!loading && error ? <p className="empty">{error}</p> : null}
					{!loading && !error && resources.length === 0 ? (
						<p className="empty">{m.catalog_empty()}</p>
					) : null}
					{!loading &&
						!error &&
						resources.map((resource) => {
							const cardBadges = computeResourceBadges(resource, badgeConfig);
							return (
								<CatalogResourceCard
									key={resource.id}
									resource={resource}
									initialFavorited={favoritedSlugs.has(resource.slug)}
									isLoggedIn={isLoggedIn}
									badges={cardBadges}
								/>
							);
						})}
				</div>

				<nav
					className="pagination"
					aria-label={m.pagination_label()}
					hidden={pagination.totalPages <= 1}
				>
					<button
						type="button"
						className="pag-btn"
						disabled={!pagination.hasPreviousPage}
						onClick={() => {
							void applyListingState(
								{ ...listingState, page: pagination.currentPage - 1 },
								"push",
								{ scrollToTop: true },
							);
						}}
					>
						<span className="material-symbols-outlined">chevron_left</span>
					</button>
					<div className="pag-numbers">
						{paginationPages.map((item) =>
							item.value === "..." ? (
								<span key={item.key} className="pag-ellipsis">
									&hellip;
								</span>
							) : (
								<button
									key={item.key}
									type="button"
									className={`pag-num${item.value === pagination.currentPage ? " active" : ""}`}
									onClick={() => {
										void applyListingState(
											{ ...listingState, page: item.value as number },
											"push",
											{ scrollToTop: true },
										);
									}}
								>
									{item.value}
								</button>
							),
						)}
					</div>
					<button
						type="button"
						className="pag-btn"
						disabled={!pagination.hasNextPage}
						onClick={() => {
							void applyListingState(
								{ ...listingState, page: pagination.currentPage + 1 },
								"push",
								{ scrollToTop: true },
							);
						}}
					>
						<span className="material-symbols-outlined">chevron_right</span>
					</button>
				</nav>
			</section>
		</div>
	);
}
