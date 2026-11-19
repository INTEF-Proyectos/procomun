import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { PublicAuthor, Resource } from "../../lib/api-client.ts";
import { getApiClient } from "../../lib/get-api-client.ts";
import { url } from "../../lib/paths.ts";
import { Breadcrumb } from "../../ui/Breadcrumb.tsx";
import { Pagination } from "../../ui/Pagination.tsx";
import { ResourceCard } from "../../ui/ResourceCard.tsx";
import { ResourceGrid } from "../../ui/ResourceGrid.tsx";
import { Skeleton } from "../../ui/Skeleton.tsx";
import "../../lib/paraglide-client.ts";
import * as m from "../../paraglide/messages.js";
import { getLocale } from "../../paraglide/runtime.js";
import "./AuthorProfileIsland.css";

const PAGE_SIZE = 12;

function displayName(author: PublicAuthor): string {
	return author.name?.trim() || m.common_anonymous();
}

export function AuthorNotFound() {
	return (
		<div className="author-page">
			<Breadcrumb
				items={[
					{ label: m.detail_home(), href: url("") },
					{ label: m.detail_explore(), href: url("explorar") },
					{ label: m.author_not_found_title() },
				]}
			/>
			<h1>{m.author_not_found_title()}</h1>
			<p className="author-muted">{m.author_not_found_desc()}</p>
		</div>
	);
}

/** Ficha pública de quien publica (#458): sin datos personales. */
export function AuthorProfileContent({
	author,
	resources,
	total,
	page,
	pageSize,
	onPageChange,
	error = "",
}: {
	author: PublicAuthor;
	resources: Resource[];
	total: number;
	page: number;
	pageSize: number;
	onPageChange: (page: number) => void;
	error?: string;
}) {
	const name = displayName(author);
	const totalPages = Math.max(1, Math.ceil(total / pageSize));

	return (
		<div className="author-page">
			<Breadcrumb
				items={[
					{ label: m.detail_home(), href: url("") },
					{ label: m.detail_explore(), href: url("explorar") },
					{ label: name },
				]}
			/>

			<header className="author-header">
				{author.image ? (
					<img className="author-avatar" src={author.image} alt="" />
				) : (
					<div className="author-avatar" aria-hidden="true">
						{name.charAt(0).toUpperCase()}
					</div>
				)}
				<div>
					<p className="author-eyebrow">{m.author_page_eyebrow()}</p>
					<h1>{name}</h1>
					<dl className="author-stats">
						<div>
							<dt>{m.author_published_count_label()}</dt>
							<dd>{total.toLocaleString(getLocale())}</dd>
						</div>
					</dl>
				</div>
			</header>

			<section aria-labelledby="author-resources-title">
				<h2 id="author-resources-title" className="author-section-title">
					{m.author_resources_title()}
				</h2>
				{error ? (
					<p className="author-muted" role="alert">
						{error}
					</p>
				) : resources.length === 0 ? (
					<p className="author-muted">{m.author_empty()}</p>
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
									createdBy: resource.createdBy,
									createdByName: resource.createdByName,
									createdByActive: resource.createdByActive ?? null,
									thumbnailUrl: resource.thumbnailUrl ?? null,
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
				<Pagination
					className="author-pagination"
					currentPage={page}
					totalPages={totalPages}
					onPageChange={onPageChange}
				/>
			</section>
		</div>
	);
}

export function AuthorProfileIsland() {
	const { id = "" } = useParams<{ id?: string }>();
	const [author, setAuthor] = useState<PublicAuthor | null>(null);
	const [resources, setResources] = useState<Resource[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [loading, setLoading] = useState(true);
	const [notFound, setNotFound] = useState(false);
	const [error, setError] = useState("");

	const load = useCallback(
		async (nextPage: number) => {
			setLoading(true);
			setError("");
			try {
				const api = await getApiClient();
				const result = id
					? await api.getPublicAuthor(id, {
							limit: PAGE_SIZE,
							offset: (nextPage - 1) * PAGE_SIZE,
						})
					: null;
				if (!result) {
					setNotFound(true);
					return;
				}
				setNotFound(false);
				setAuthor(result.author);
				setResources(result.data);
				setTotal(result.total);
				setPage(nextPage);
			} catch {
				setError(m.author_load_error());
			} finally {
				setLoading(false);
			}
		},
		[id],
	);

	useEffect(() => {
		void load(1);
	}, [load]);

	if (notFound) return <AuthorNotFound />;

	if (loading && !author) {
		return (
			<div className="author-page" aria-busy="true">
				<Skeleton variant="rectangular" height="80px" />
				<Skeleton lines={4} />
			</div>
		);
	}

	if (!author) {
		return (
			<div className="author-page">
				<p className="author-muted" role="alert">
					{error || m.author_load_error()}
				</p>
			</div>
		);
	}

	return (
		<AuthorProfileContent
			author={author}
			resources={resources}
			total={total}
			page={page}
			pageSize={PAGE_SIZE}
			error={error}
			onPageChange={(next) => {
				void load(next);
				window.scrollTo({ top: 0 });
			}}
		/>
	);
}
