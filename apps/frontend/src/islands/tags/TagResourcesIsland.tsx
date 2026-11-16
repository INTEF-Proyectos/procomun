import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { Resource, TagRecord } from "../../lib/api-client.ts";
import { getApiClient } from "../../lib/get-api-client.ts";
import { url } from "../../lib/paths.ts";
import { ResourceCard } from "../../ui/ResourceCard.tsx";
import { ResourceGrid } from "../../ui/ResourceGrid.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import "./TagResourcesIsland.css";

const PAGE_SIZE = 12;

export function TagResourcesIsland() {
	const { slug: routeSlug } = useParams<{ slug?: string }>();
	const slug = routeSlug?.trim() ?? "";

	const [tag, setTag] = useState<TagRecord | null>(null);
	const [resources, setResources] = useState<Resource[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [loading, setLoading] = useState(true);
	const [notFound, setNotFound] = useState(false);
	const [error, setError] = useState("");

	const load = useCallback(
		async (nextPage: number) => {
			if (!slug) {
				setNotFound(true);
				setLoading(false);
				return;
			}
			setLoading(true);
			setError("");
			setNotFound(false);
			try {
				const api = await getApiClient();
				const result = await api.listPublicTagResources(slug, {
					limit: PAGE_SIZE,
					offset: (nextPage - 1) * PAGE_SIZE,
				});
				setTag(result.tag);
				setResources(result.data);
				setTotal(result.total);
				setPage(nextPage);
			} catch {
				// Fallback: try tag detail for 404 vs empty
				try {
					const api = await getApiClient();
					const t = await api.getPublicTagBySlug(slug);
					if (!t) {
						setNotFound(true);
						setTag(null);
						setResources([]);
						setTotal(0);
					} else {
						setTag(t);
						setResources([]);
						setTotal(0);
						setError("No se pudieron cargar los recursos de esta etiqueta.");
					}
				} catch {
					setNotFound(true);
				}
			} finally {
				setLoading(false);
			}
		},
		[slug],
	);

	useEffect(() => {
		void load(1);
	}, [load]);

	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	if (loading) {
		return (
			<div className="tag-page">
				<Skeleton variant="rectangular" height="80px" />
				<Skeleton lines={4} />
			</div>
		);
	}

	if (notFound) {
		return (
			<div className="tag-page tag-page--empty">
				<nav className="tag-breadcrumb" aria-label="Migas de pan">
					<a href={url("")}>Inicio</a>
					<span aria-hidden="true"> / </span>
					<a href={url("explorar")}>Explorar</a>
					<span aria-hidden="true"> / </span>
					<span>Etiqueta no encontrada</span>
				</nav>
				<h1>Etiqueta no encontrada</h1>
				<p>No existe una etiqueta con el identificador «{slug}».</p>
				<p>
					<a href={url("explorar")} className="tag-cta">
						Volver a explorar
					</a>
				</p>
			</div>
		);
	}

	return (
		<div className="tag-page">
			<nav className="tag-breadcrumb" aria-label="Migas de pan">
				<a href={url("")}>Inicio</a>
				<span aria-hidden="true"> / </span>
				<a href={url("explorar")}>Explorar</a>
				<span aria-hidden="true"> / </span>
				<span>{tag?.label ?? slug}</span>
			</nav>

			<header className="tag-header">
				<p className="tag-eyebrow">Etiqueta</p>
				<h1>{tag?.label ?? slug}</h1>
				{tag?.description ? (
					<p className="tag-description">{tag.description}</p>
				) : null}
				<p className="tag-meta">
					{total} recurso{total === 1 ? "" : "s"} ·{" "}
					<a
						href={url(`explorar?tag=${encodeURIComponent(tag?.slug ?? slug)}`)}
					>
						Filtrar en el catalogo
					</a>
				</p>
			</header>

			{error ? (
				<p className="tag-error" role="alert">
					{error}
				</p>
			) : null}

			{resources.length === 0 && !error ? (
				<p className="tag-empty">
					Todavia no hay recursos publicados con esta etiqueta.
				</p>
			) : (
				<ResourceGrid>
					{resources.map((resource) => (
						<ResourceCard
							key={resource.id}
							resource={{
								id: resource.id,
								slug: resource.slug,
								title: resource.title,
								description: resource.description,
								resourceType: resource.resourceType,
								language: resource.language,
								license: resource.license,
								author: resource.author ?? null,
								createdBy: resource.createdBy ?? null,
								createdByName: resource.createdByName ?? null,
								thumbnailUrl: null,
								elpxPreview: resource.elpxPreview ?? null,
								rating: resource.rating,
								favoriteCount: Number(resource.favoriteCount ?? 0),
								editorialStatus: resource.editorialStatus,
								validatedAt: resource.validatedAt ?? null,
								validationSource: resource.validationSource ?? null,
								createdAt:
									typeof resource.createdAt === "string"
										? resource.createdAt
										: "",
							}}
							href={url(`recurso?slug=${resource.slug}`)}
						/>
					))}
				</ResourceGrid>
			)}

			{total > PAGE_SIZE ? (
				<div className="tag-pager">
					<button
						type="button"
						disabled={page <= 1}
						onClick={() => void load(page - 1)}
					>
						Anterior
					</button>
					<span>
						Pagina {page} de {totalPages}
					</span>
					<button
						type="button"
						disabled={page >= totalPages}
						onClick={() => void load(page + 1)}
					>
						Siguiente
					</button>
				</div>
			) : null}
		</div>
	);
}
