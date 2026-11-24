import {
	type FormEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import type {
	CollectionDetailRecord,
	CollectionRecord,
	PublicKnowledgeAreaCatalog,
} from "../../lib/api-client.ts";
import {
	classificationLineText,
	formatEducationalClassifications,
	sanitizeEducationalFilter,
} from "../../lib/educational-classification.ts";
import { getApiClient } from "../../lib/get-api-client.ts";
import {
	buildListingUrl,
	type HistoryUpdateMode,
	type ListingState,
	readListingState,
	writeListingStateToHistory,
} from "../../lib/listing-history.ts";
import { url } from "../../lib/paths.ts";
import { resourceCardMedia } from "../../lib/resource-card-media.ts";
import { languageLabel } from "../../lib/resource-display.ts";
import {
	LANGUAGE_OPTIONS,
	loadFilterOptions,
} from "../../lib/resource-filters.ts";
import { formatDateLong } from "../../lib/shared-utils.ts";
import { trackViewOnce } from "../../lib/view-tracking.ts";
import { ResourceByline } from "../../ui/AuthorLinks.tsx";
import { CardTypeMarker } from "../../ui/CardTypeMarker.tsx";
import { EducationalSearchFilters } from "../catalog/EducationalSearchFilters.tsx";
import { KnowledgeAreaSearchFilters } from "../catalog/KnowledgeAreaSearchFilters.tsx";
import { KeywordCatalogField } from "../resources/KeywordCatalogField.tsx";
import { KnowledgeCatalogError } from "../resources/KnowledgeClassificationFields.tsx";
import { RatingIsland } from "../social/RatingIsland.tsx";
import { ReportButton } from "../social/ReportButton.tsx";
import "./PublicCollectionsIsland.css";
import "../../lib/paraglide-client.ts";
import * as m from "../../paraglide/messages.js";

const PAGE_SIZE = 9;

interface CollectionLocationState extends ListingState {
	slug: string | null;
}

function truncate(text: string, maxLength: number) {
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength)}...`;
}

function coverStyle(coverImageUrl?: string | null) {
	if (!coverImageUrl) {
		return { backgroundImage: "linear-gradient(135deg, #0f4ccf, #60a5fa)" };
	}
	return {
		backgroundImage: `linear-gradient(rgba(15, 76, 207, 0.12), rgba(15, 76, 207, 0.42)), url("${coverImageUrl}")`,
	};
}

/** Filtros aplicados, sin el texto: lo que el panel cerrado no deja ver (#629). */
function activeFilterCount(state: CollectionLocationState): number {
	return (
		(state.language ? 1 : 0) +
		(state.tag ? 1 : 0) +
		(state.educationalCategory ? 1 : 0) +
		(state.knowledgeAreas?.length ?? 0)
	);
}

function readCollectionLocation(search: string): CollectionLocationState {
	const state = readListingState(search);
	const educational = sanitizeEducationalFilter(
		state.educationalCategory,
		state.educationalOption,
	);
	return {
		...state,
		page: Number.isSafeInteger(state.page) ? state.page : 1,
		resourceType: "",
		license: "",
		professionalFamilies: [],
		educationalCategory: educational.categoryId,
		educationalOption: educational.optionId,
		slug: new URLSearchParams(search).get("slug"),
	};
}

function buildCollectionUrl(state: CollectionLocationState) {
	const slug = new URLSearchParams();
	if (state.slug) slug.set("slug", state.slug);
	return buildListingUrl(url("colecciones"), slug.toString(), state);
}

/** Detalle de una colección pública; sin estado, para poder probarlo. */
export function CollectionDetailContent({
	detail,
	onBack,
	backHref = url("colecciones"),
	currentUserId = null,
}: {
	detail: CollectionDetailRecord;
	onBack: () => void;
	backHref?: string;
	currentUserId?: string | null;
}) {
	const metadata = [
		{
			label: m.detail_language(),
			value: detail.language ? languageLabel(detail.language) : "",
		},
		{
			label: m.collection_detail_keywords(),
			value: detail.catalogKeywords?.map(({ label }) => label).join(", "),
		},
		{
			label: m.knowledge_areas_label(),
			value: detail.knowledgeAreas?.map(({ label }) => label).join(", "),
		},
		{
			label: m.collection_detail_educational(),
			value: formatEducationalClassifications(detail.educationalAreas)
				.map(classificationLineText)
				.join("; "),
		},
	].filter((field) => field.value);

	return (
		<section className="collections-shell">
			<div className="collection-detail-toolbar">
				<a
					href={backHref}
					className="collections-back-link"
					onClick={(event) => {
						if (
							event.metaKey ||
							event.ctrlKey ||
							event.shiftKey ||
							event.altKey
						)
							return;
						event.preventDefault();
						onBack();
					}}
				>
					Volver al listado
				</a>
				{/* #539: las colecciones también se denuncian. */}
				<ReportButton
					target="collection"
					slug={detail.slug}
					currentUserId={currentUserId}
					className="collection-report-btn"
				/>
			</div>

			<header
				className="collection-detail-hero"
				style={coverStyle(detail.coverImageUrl)}
			>
				<div className="collection-detail-overlay">
					<p className="collections-eyebrow">Colección pública</p>
					<h1>{detail.title}</h1>
					<p>{detail.description}</p>
					<ul
						className="collection-detail-meta"
						/* biome-ignore lint/a11y/noRedundantRoles: Safari requiere el rol en listas con display flex. */
						role="list"
						aria-label="Metadatos de la colección"
					>
						<li>{detail.resourceCount ?? detail.resources.length} recursos</li>
						<li>
							{detail.viewCount === 1
								? m.detail_views_one()
								: m.detail_views_other({
										count: String(detail.viewCount ?? 0),
									})}
						</li>
						<li>Curator: {detail.curatorName ?? "Equipo editorial"}</li>
						<li>
							Actualizada {formatDateLong(detail.updatedAt ?? detail.createdAt)}
						</li>
					</ul>
				</div>
			</header>

			{metadata.length > 0 && (
				<section
					className="collection-detail-section"
					aria-labelledby="collection-metadata-title"
				>
					<h2 id="collection-metadata-title">{m.detail_technical()}</h2>
					<dl>
						{metadata.map(({ label, value }) => (
							<div key={label}>
								<dt>{label}</dt>
								<dd>{value}</dd>
							</div>
						))}
					</dl>
				</section>
			)}

			<section
				className="collection-detail-section"
				aria-labelledby="collection-resources-title"
			>
				<div className="collections-section-head">
					<div>
						<p className="collections-eyebrow">Recursos asociados</p>
						<h2 id="collection-resources-title">Listado de recursos</h2>
					</div>
				</div>
				<div className="collection-resource-grid">
					{detail.resources.map((resource) => {
						const media = resourceCardMedia(resource);
						return (
							// #458: el nombre del autor es un enlace, asi que la
							// tarjeta no lo es; el titulo se estira a toda ella y no se
							// anidan enlaces.
							<article
								key={resource.resourceId}
								className="collection-resource-card"
							>
								{media.kind === "image" ? (
									<div className="col-res-preview">
										<img src={media.url} alt="" />
									</div>
								) : (
									// #470: el iframe sale de los listados. Sin imagen ni
									// miniatura generada, el marcador del tipo de recurso.
									<div className="col-res-preview col-res-preview-empty">
										<CardTypeMarker icon={media.icon} />
									</div>
								)}
								<p className="collection-resource-type">
									{resource.resourceType}
								</p>
								<h3>
									<a
										className="card-stretched-link"
										href={url(`recurso?slug=${resource.slug}`)}
									>
										{resource.title}
									</a>
								</h3>
								<p>{truncate(resource.description ?? "", 180)}</p>
								<div className="collection-resource-meta">
									{/* Sin idioma en origen no se muestra ninguno (#473). */}
									{resource.language && (
										<span>{resource.language.toUpperCase()}</span>
									)}
									<span>{resource.license}</span>
									<span>
										<ResourceByline resource={resource} />
									</span>
								</div>
							</article>
						);
					})}
				</div>
			</section>
			<div className="collection-detail-section">
				<RatingIsland
					key={detail.slug}
					target="collection"
					slug={detail.slug}
					currentUserId={currentUserId}
				/>
			</div>
		</section>
	);
}

export function PublicCollectionsIsland() {
	const [listing, setListing] = useState(() => readCollectionLocation(""));
	const [query, setQuery] = useState("");
	const [loading, setLoading] = useState(true);
	const [collections, setCollections] = useState<CollectionRecord[]>([]);
	const [total, setTotal] = useState(0);
	const [detail, setDetail] = useState<CollectionDetailRecord | null>(null);
	const [error, setError] = useState("");
	const [currentUserId, setCurrentUserId] = useState<string | null>(null);
	const [languageOptions, setLanguageOptions] = useState(LANGUAGE_OPTIONS);
	const [areaCatalog, setAreaCatalog] =
		useState<PublicKnowledgeAreaCatalog | null>(null);
	const [areaCatalogFailed, setAreaCatalogFailed] = useState(false);
	const [tagLabel, setTagLabel] = useState<{
		slug: string;
		label: string;
	} | null>(null);
	const requestId = useRef(0);

	const loadAreaCatalog = useCallback(() => {
		setAreaCatalogFailed(false);
		void getApiClient()
			.then((api) => api.getKnowledgeAreaCatalog())
			.then(setAreaCatalog)
			.catch(() => setAreaCatalogFailed(true));
	}, []);

	useEffect(() => {
		void getApiClient().then((api) => {
			void api
				.getSession()
				.then((session) => setCurrentUserId(session?.user?.id ?? null))
				.catch(() => {});
		});
		loadAreaCatalog();
		void loadFilterOptions(
			"language",
			m.catalog_all_languages(),
			LANGUAGE_OPTIONS,
		).then(setLanguageOptions);
	}, [loadAreaCatalog]);

	const detailSlug = detail?.slug;
	useEffect(() => {
		if (!detailSlug) return;
		let active = true;
		void trackViewOnce(`collection:${detailSlug}`, async (_, sessionId) => {
			const api = await getApiClient();
			return api.trackCollectionView(detailSlug, sessionId);
		}).then((viewCount) => {
			if (!active || viewCount === null) return;
			setDetail((current) =>
				current?.slug === detailSlug ? { ...current, viewCount } : current,
			);
		});
		return () => {
			active = false;
		};
	}, [detailSlug]);

	useEffect(() => {
		if (!listing.tag) return;
		let cancelled = false;
		void getApiClient()
			.then((api) => api.getPublicTagBySlug(listing.tag))
			.then((tag) => {
				if (!cancelled && tag)
					setTagLabel({ slug: listing.tag, label: tag.label });
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [listing.tag]);

	const loadLocation = useCallback(async (next: CollectionLocationState) => {
		const id = ++requestId.current;
		setListing(next);
		setLoading(true);
		setError("");
		setDetail(null);
		try {
			const api = await getApiClient();
			if (next.slug) {
				const result = await api.getPublicCollectionBySlug(next.slug);
				if (id !== requestId.current) return;
				setDetail(result);
				if (!result) {
					// Sin ficha no se dejan a la vista las tarjetas del listado anterior.
					setCollections([]);
					setTotal(0);
					setError("La colección solicitada no existe o no está publicada.");
				}
				return;
			}
			const result = await api.listPublicCollections({
				q: next.query || undefined,
				limit: PAGE_SIZE,
				offset: (next.page - 1) * PAGE_SIZE,
				language: next.language,
				tag: next.tag,
				knowledgeAreas: next.knowledgeAreas,
				educationalCategory: next.educationalCategory,
				educationalOption: next.educationalOption,
			});
			if (id !== requestId.current) return;
			setCollections(result.data);
			setTotal(result.total);
		} catch {
			if (id !== requestId.current) return;
			setDetail(null);
			setCollections([]);
			setTotal(0);
			setError(
				next.slug
					? "No se pudo cargar el detalle de la colección."
					: "No se pudieron cargar las colecciones.",
			);
		} finally {
			if (id === requestId.current) setLoading(false);
		}
	}, []);

	useEffect(() => {
		function syncFromLocation() {
			const next = readCollectionLocation(window.location.search);
			setQuery(next.query);
			void loadLocation(next);
		}

		syncFromLocation();
		window.addEventListener("popstate", syncFromLocation);
		return () => window.removeEventListener("popstate", syncFromLocation);
	}, [loadLocation]);

	function navigate(next: CollectionLocationState, mode: HistoryUpdateMode) {
		writeListingStateToHistory(window.history, buildCollectionUrl(next), mode);
		void loadLocation(next);
	}

	function changeFilters(filters: Partial<CollectionLocationState>) {
		// El texto escrito sin pulsar Buscar también se aplica: así el cuadro de
		// búsqueda y los resultados no se contradicen.
		navigate(
			{ ...listing, ...filters, query: query.trim(), page: 1, slug: null },
			"replace",
		);
	}

	function handleSearch(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		navigate({ ...listing, query: query.trim(), page: 1, slug: null }, "push");
	}

	const { page } = listing;
	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	if (detail) {
		const back = { ...listing, slug: null };
		return (
			<CollectionDetailContent
				detail={detail}
				currentUserId={currentUserId}
				backHref={buildCollectionUrl(back)}
				onBack={() => navigate(back, "push")}
			/>
		);
	}

	const activeFilters = activeFilterCount(listing);
	return (
		<section className="collections-shell">
			<header className="collections-hero">
				<p className="collections-eyebrow">Colecciones editoriales</p>
				<h1>Colecciones publicadas</h1>
				<p>
					Explora agrupaciones temáticas curadas por el equipo editorial para
					encontrar secuencias y selecciones de recursos ya organizadas.
				</p>
				<search>
					<form className="collections-search" onSubmit={handleSearch}>
						<input
							type="search"
							placeholder="Buscar por título o descripción"
							aria-label="Buscar colecciones"
							value={query}
							onChange={(event) => setQuery(event.currentTarget.value)}
						/>
						<button type="submit">Buscar</button>
					</form>
				</search>
			</header>

			<details className="collections-filters">
				<summary>
					<span>{m.catalog_advanced_filters()}</span>
					{activeFilters > 0 ? (
						<span className="collections-filters-count">
							{activeFilters === 1
								? m.collections_filters_active_one()
								: m.collections_filters_active_other({
										count: String(activeFilters),
									})}
						</span>
					) : null}
				</summary>
				<div className="collections-filters-fields">
					<EducationalSearchFilters
						categoryId={listing.educationalCategory ?? ""}
						optionId={listing.educationalOption ?? ""}
						onChange={(next) =>
							changeFilters({
								educationalCategory: next.categoryId,
								educationalOption: next.optionId,
							})
						}
					/>
					{areaCatalogFailed ? (
						<KnowledgeCatalogError onRetry={loadAreaCatalog} />
					) : null}
					<KnowledgeAreaSearchFilters
						catalog={areaCatalog}
						educationalCategory={listing.educationalCategory ?? ""}
						knowledgeAreas={listing.knowledgeAreas ?? []}
						professionalFamilies={[]}
						includeProfessionalFamilies={false}
						areaHelp={m.collections_knowledge_areas_filter_help()}
						onChange={({ knowledgeAreas }) => changeFilters({ knowledgeAreas })}
					/>
					<div className="filter-group">
						<label htmlFor="collection-language">{m.catalog_language()}</label>
						<select
							id="collection-language"
							value={listing.language}
							onChange={(event) =>
								changeFilters({ language: event.currentTarget.value })
							}
						>
							{languageOptions.map(({ value, label }) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</select>
					</div>
					<div className="filter-group">
						<KeywordCatalogField
							id="collection-filter-tag"
							filter
							includeTags={false}
							selected={
								listing.tag
									? [
											{
												id: listing.tag,
												slug: listing.tag,
												label:
													tagLabel?.slug === listing.tag
														? tagLabel.label
														: listing.tag,
											},
										]
									: []
							}
							onChange={(next) => {
								const tag = next.at(-1);
								setTagLabel(tag ? { slug: tag.slug, label: tag.label } : null);
								changeFilters({ tag: tag?.slug ?? "" });
							}}
						/>
					</div>
				</div>
			</details>
			{/* Fuera del panel: se puede limpiar sin abrirlo (#629). */}
			{activeFilters > 0 || listing.query ? (
				<button
					type="button"
					className="clear-btn collections-filters-clear"
					onClick={() => {
						setQuery("");
						navigate(readCollectionLocation(""), "replace");
					}}
				>
					{m.catalog_clear_filters()}
				</button>
			) : null}

			<section
				className="collection-list-section"
				aria-labelledby="collections-results-title"
			>
				<div className="collections-section-head">
					<div>
						<p className="collections-eyebrow">Resultados</p>
						<h2 id="collections-results-title" aria-live="polite">
							{loading
								? "Cargando colecciones..."
								: `${total} colecciones publicadas`}
						</h2>
					</div>
				</div>

				{error ? (
					<p className="collections-feedback collections-feedback-error">
						{error}
					</p>
				) : null}

				{/* La rejilla y la paginación siguen montadas mientras carga para que
				    el foco no se pierda al cambiar de página. */}
				<div className="collection-card-grid">
					{collections.map((collection) => (
						<a
							key={collection.id}
							href={buildCollectionUrl({ ...listing, slug: collection.slug })}
							className="collection-public-card"
							onClick={(event) => {
								if (
									event.metaKey ||
									event.ctrlKey ||
									event.shiftKey ||
									event.altKey
								)
									return;
								event.preventDefault();
								navigate({ ...listing, slug: collection.slug }, "push");
							}}
						>
							<div
								className="collection-public-card-cover"
								style={coverStyle(collection.coverImageUrl)}
							/>
							<div className="collection-public-card-body">
								<p className="collection-public-card-eyebrow">Colección</p>
								<h3>{collection.title}</h3>
								<p>{truncate(collection.description ?? "", 180)}</p>
								<div className="collection-public-card-meta">
									<span>{collection.resourceCount ?? 0} recursos</span>
									<span>{collection.curatorName ?? "Equipo editorial"}</span>
								</div>
							</div>
						</a>
					))}
				</div>

				{!loading && !collections.length && !error ? (
					<p className="collections-feedback">
						No hay colecciones publicadas para los filtros actuales.
					</p>
				) : null}

				<nav
					className="collections-pagination"
					aria-label="Paginación de colecciones"
					hidden={total <= PAGE_SIZE}
				>
					<button
						type="button"
						disabled={page <= 1}
						onClick={() => {
							navigate({ ...listing, page: page - 1 }, "push");
						}}
					>
						Anterior
					</button>
					<span>{`Página ${page} de ${totalPages}`}</span>
					<button
						type="button"
						disabled={page >= totalPages}
						onClick={() => {
							navigate({ ...listing, page: page + 1 }, "push");
						}}
					>
						Siguiente
					</button>
				</nav>
			</section>
		</section>
	);
}

export { activeFilterCount, readCollectionLocation };
