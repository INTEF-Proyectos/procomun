import {
	type KeyboardEvent,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { useElpxEmbedRelay } from "../../hooks/use-elpx-embed-relay.ts";
import type {
	RelatedResource,
	RelatedResourcesResult,
	Resource,
	SessionData,
} from "../../lib/api-client.ts";
import { getApiClient } from "../../lib/get-api-client.ts";
import { url } from "../../lib/paths.ts";
import {
	FILE_ICONS,
	formatBytes,
	statusLabelOf,
} from "../../lib/resource-display.ts";
import {
	buildExportFilename,
	getResourceElpxFileUrl,
	listDownloadMenuOptions,
	RESOURCE_EXPORT_OPTIONS,
	type ResourceExportKind,
} from "../../lib/resource-export.ts";
import type { ResourceSummary } from "../../lib/types/resource-extended.ts";
import { ResourceCard } from "../../ui/ResourceCard.tsx";
import { FavoriteIsland } from "../social/FavoriteIsland.tsx";
import { RatingIsland } from "../social/RatingIsland.tsx";
import { ReportButton } from "../social/ReportButton.tsx";
import { EmbedModal } from "./EmbedModal.tsx";
import "../../lib/paraglide-client.ts";
import { hasMinRole } from "../../lib/shared-utils.ts";
import * as m from "../../paraglide/messages.js";
import { getLocale } from "../../paraglide/runtime.js";

function toResourceSummary(item: RelatedResource): ResourceSummary {
	return {
		id: item.id,
		slug: item.slug,
		title: item.title,
		description: item.description,
		resourceType: item.resourceType,
		language: item.language,
		license: item.license,
		author: item.author,
		editorialStatus: item.editorialStatus ?? "published",
		// Related payload does not include timestamps; cards only need identity fields.
		createdAt: "",
	};
}

function RelatedResourcesSection({
	title,
	description,
	items,
	headingId,
}: {
	title: string;
	description?: string;
	items: RelatedResource[];
	headingId: string;
}) {
	if (items.length === 0) return null;

	return (
		<section className="related-section" aria-labelledby={headingId}>
			<div className="related-section-header">
				<h2 id={headingId}>{title}</h2>
				{description ? (
					<p className="related-section-desc">{description}</p>
				) : null}
			</div>
			<div className="related-grid">
				{items.map((item) => (
					<ResourceCard
						key={item.id}
						resource={toResourceSummary(item)}
						href={url(`recurso?slug=${item.slug}`)}
					/>
				))}
			</div>
		</section>
	);
}

function ShareButton() {
	const [copied, setCopied] = useState(false);

	const handleShare = useCallback(() => {
		navigator.clipboard.writeText(window.location.href).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2500);
		});
	}, []);

	return (
		<button
			className={`meta-action-btn${copied ? " meta-action-btn-success" : ""}`}
			type="button"
			onClick={handleShare}
			aria-label={copied ? m.detail_shared_label() : m.detail_share_label()}
		>
			<span className="material-symbols-outlined" aria-hidden="true">
				{copied ? "check" : "share"}
			</span>
			{copied ? m.detail_shared() : m.detail_share()}
		</button>
	);
}

function EmbedSection({
	title,
	previewUrl,
}: {
	title: string;
	previewUrl: string;
	slug: string;
}) {
	const [copiedEmbed, setCopiedEmbed] = useState(false);
	const fullUrl =
		typeof window !== "undefined"
			? new URL(previewUrl, window.location.origin).href
			: previewUrl;
	const iframeCode = `<iframe title="${title.replace(/"/g, "&quot;")}" src="${fullUrl}" width="1100" height="540" frameborder="0" allowfullscreen></iframe>`;

	function handleCopy() {
		navigator.clipboard.writeText(iframeCode).then(() => {
			setCopiedEmbed(true);
			setTimeout(() => setCopiedEmbed(false), 2500);
		});
	}

	return (
		<section className="embed-section">
			<h2>{m.detail_embed_title()}</h2>
			<p className="embed-description">{m.detail_embed_desc()}</p>
			<div className="embed-code-wrapper">
				<textarea
					className="embed-textarea"
					readOnly
					value={iframeCode}
					rows={3}
					onClick={(e) => (e.target as HTMLTextAreaElement).select()}
					aria-label={m.detail_embed_label()}
				/>
				<button
					className={`embed-copy-btn${copiedEmbed ? " embed-copy-success" : ""}`}
					type="button"
					onClick={handleCopy}
				>
					<span className="material-symbols-outlined" aria-hidden="true">
						{copiedEmbed ? "check" : "content_copy"}
					</span>
					{copiedEmbed ? m.detail_embed_copied() : m.detail_embed_copy()}
				</button>
			</div>
		</section>
	);
}

function resourceDate(dateValue: Resource["createdAt"]) {
	if (!dateValue) return "";
	return new Date(dateValue).toLocaleDateString(getLocale(), {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

function getStatusBadgeClass(editorialStatus: string): string {
	switch (editorialStatus) {
		case "draft":
			return "detail-status-badge draft";
		case "review":
			return "detail-status-badge review";
		case "archived":
			return "detail-status-badge archived";
		default:
			return "detail-status-badge";
	}
}

function DownloadMenu({
	hasDirectFile,
	hasExports,
	totalFileSize,
	downloadCount,
	exportCounts,
	exportReady,
	exportingFormat,
	onDirectDownload,
	onExport,
}: {
	hasDirectFile: boolean;
	hasExports: boolean;
	totalFileSize: number;
	downloadCount: number;
	exportCounts?: ResourceStats["exportCounts"];
	exportReady: boolean;
	exportingFormat: ResourceExportKind | null;
	onDirectDownload: () => void;
	onExport: (format: ResourceExportKind) => void;
}) {
	const options = listDownloadMenuOptions({ hasDirectFile, hasExports });
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const pendingFocus = useRef<"start" | "end" | null>(null);
	const menuId = useId();
	const preparingLabel = options.find(
		(option) => option.kind === "export" && option.id === exportingFormat,
	)?.label;

	const menuItems = useCallback(() => {
		return Array.from(
			rootRef.current?.querySelectorAll<HTMLButtonElement>(
				'[role="menuitem"]:not(:disabled)',
			) ?? [],
		);
	}, []);

	const focusEdge = useCallback(
		(edge: "start" | "end") => {
			const items = menuItems();
			const target = edge === "end" ? items.at(-1) : items[0];
			target?.focus();
		},
		[menuItems],
	);

	useEffect(() => {
		if (!open) return;
		const edge = pendingFocus.current;
		if (!edge) return;
		pendingFocus.current = null;
		focusEdge(edge);
	}, [open, focusEdge]);

	useEffect(() => {
		if (!open) return;
		function handlePointerDown(event: PointerEvent) {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		}
		function handleEscape(event: globalThis.KeyboardEvent) {
			if (event.key !== "Escape") return;
			setOpen(false);
			triggerRef.current?.focus();
		}
		document.addEventListener("pointerdown", handlePointerDown);
		document.addEventListener("keydown", handleEscape);
		return () => {
			document.removeEventListener("pointerdown", handlePointerDown);
			document.removeEventListener("keydown", handleEscape);
		};
	}, [open]);

	if (options.length === 0) return null;

	function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		event.preventDefault();
		const edge = event.key === "ArrowUp" ? "end" : "start";
		if (open) {
			focusEdge(edge);
			return;
		}
		pendingFocus.current = edge;
		setOpen(true);
	}

	function handleMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
		if (
			event.key !== "ArrowDown" &&
			event.key !== "ArrowUp" &&
			event.key !== "Home" &&
			event.key !== "End"
		) {
			return;
		}
		const items = menuItems();
		if (items.length === 0) return;
		event.preventDefault();
		if (event.key === "Home") {
			items[0]?.focus();
			return;
		}
		if (event.key === "End") {
			items.at(-1)?.focus();
			return;
		}
		const current = items.indexOf(document.activeElement as HTMLButtonElement);
		const delta = event.key === "ArrowDown" ? 1 : -1;
		const next =
			current === -1 ? 0 : (current + delta + items.length) % items.length;
		items[next]?.focus();
	}

	return (
		<div className="detail-download" ref={rootRef}>
			<button
				ref={triggerRef}
				type="button"
				className="detail-action-outline detail-download-trigger"
				aria-expanded={open}
				aria-haspopup="menu"
				aria-controls={menuId}
				onClick={() => setOpen((value) => !value)}
				onKeyDown={handleTriggerKeyDown}
			>
				<span className="material-symbols-outlined" aria-hidden="true">
					download
				</span>
				{exportingFormat && preparingLabel
					? `Preparando ${preparingLabel}...`
					: m.detail_download()}
				{downloadCount > 0 ? (
					<span className="detail-action-count">{downloadCount}</span>
				) : null}
				<span className="material-symbols-outlined" aria-hidden="true">
					{open ? "expand_less" : "expand_more"}
				</span>
			</button>
			{open ? (
				<div
					id={menuId}
					className="detail-download-menu"
					role="menu"
					aria-label={m.detail_download()}
					onKeyDown={handleMenuKeyDown}
				>
					{options.map((option) => {
						const unavailable =
							option.kind === "export" &&
							(!exportReady || exportingFormat !== null);
						const label =
							option.kind === "export" && exportingFormat === option.id
								? `Preparando ${option.label}...`
								: option.kind === "direct" && totalFileSize > 0
									? `${option.label} (${formatBytes(totalFileSize)})`
									: option.label;
						const count =
							option.kind === "export" ? exportCounts?.[option.id] : 0;
						return (
							<button
								key={option.id}
								type="button"
								role="menuitem"
								className="detail-download-item"
								disabled={unavailable}
								onClick={() => {
									if (option.kind === "direct") {
										onDirectDownload();
										setOpen(false);
										return;
									}
									onExport(option.id);
								}}
							>
								<span>{label}</span>
								{count ? (
									<span className="detail-action-count">{count}</span>
								) : null}
							</button>
						);
					})}
				</div>
			) : null}
		</div>
	);
}

function ResourceDetailContent({
	resource,
	session,
	stats,
	isFavorited,
	related,
	onDownloadTracked,
}: {
	resource: Resource;
	session: SessionData | null;
	stats: ResourceStats | null;
	isFavorited: boolean;
	related: RelatedResourcesResult | null;
	onDownloadTracked?: (
		count: number,
		format?: ResourceExportKind | "direct",
	) => void;
}) {
	const status = statusLabelOf(resource.editorialStatus);
	const keywords = resource.keywords
		? resource.keywords
				.split(",")
				.map((keyword) => keyword.trim())
				.filter(Boolean)
		: [];
	const publicationDate = resourceDate(resource.createdAt);
	const updatedDate = resourceDate(resource.updatedAt);
	const currentUserId = session?.user?.id ?? null;
	const userRole = session?.user?.role ?? "reader";
	const isOwner =
		currentUserId !== null && resource.createdBy === currentUserId;
	const canEdit =
		hasMinRole(userRole, "author") &&
		(isOwner || hasMinRole(userRole, "curator"));
	const authorName =
		resource.createdByName || resource.author || m.detail_unknown_author();
	const authorInitial = authorName.charAt(0).toUpperCase();
	// Se derivan los valores, no solo los booleanos: un `hasPreview: boolean` no
	// permite a TypeScript estrechar `resource.elpxPreview` en los usos, y menos
	// dentro de un closure. Con el valor ya extraído, el narrowing es real.
	const previewUrl = resource.elpxPreview?.previewUrl;
	const hasPreview = !!previewUrl;
	const mediaItems = resource.mediaItems ?? [];
	const hasFiles = mediaItems.length > 0;
	const firstFileUrl = mediaItems[0]?.url;
	const totalFileSize = mediaItems.reduce(
		(sum, item) => sum + (item.fileSize ?? 0),
		0,
	);
	const exportSourceUrl = getResourceElpxFileUrl(resource);
	const iframeRef = useRef<HTMLIFrameElement | null>(null);
	// Relay de embeds del preview: vídeos/PDF promocionados a un player de
	// confianza en el frame principal sin perder el origen opaco (ADR-0027).
	const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
	const { activeEmbed, close: closeEmbed } = useElpxEmbedRelay(
		previewIframeRef,
		resource.elpxPreview?.previewUrl,
	);
	const [exportReady, setExportReady] = useState(false);
	const [exportingFormat, setExportingFormat] =
		useState<ResourceExportKind | null>(null);
	const [exportError, setExportError] = useState("");

	useEffect(() => {
		if (!exportSourceUrl) return;

		function handleMessage(event: MessageEvent) {
			if (event.source !== iframeRef.current?.contentWindow) return;
			const message = event.data as {
				type?: string;
				requestId?: string;
				bytes?: ArrayBuffer;
				filename?: string;
				mimeType?: string;
				error?: string;
			};
			if (!message?.type) return;

			if (message.type === "EXELEARNING_READY") {
				iframeRef.current?.contentWindow?.postMessage(
					{
						type: "CONFIGURE",
						requestId: `cfg-${crypto.randomUUID()}`,
						data: {
							hideUI: { fileMenu: true, saveButton: true, userMenu: true },
						},
					},
					window.location.origin,
				);
				return;
			}

			if (message.type === "DOCUMENT_LOADED") {
				setExportReady(true);
				setExportError("");
				return;
			}

			if (message.type === "EXPORT_FILE" && message.bytes) {
				const blob = new Blob([message.bytes], {
					type: message.mimeType || "application/octet-stream",
				});
				const downloadUrl = URL.createObjectURL(blob);
				const link = document.createElement("a");
				link.href = downloadUrl;
				link.download = message.filename || "export.zip";
				link.style.display = "none";
				document.body.appendChild(link);
				link.click();
				document.body.removeChild(link);
				URL.revokeObjectURL(downloadUrl);
				const formatTrack = exportingFormat || undefined;
				setExportingFormat(null);
				void getApiClient()
					.then((api) => api.trackDownload(resource.slug, formatTrack))
					.then((result) => {
						if (onDownloadTracked) onDownloadTracked(result.count, formatTrack);
					})
					.catch(() => {});
				return;
			}

			if (message.type === "REQUEST_EXPORT_ERROR") {
				setExportError(message.error || "No se pudo exportar el recurso.");
				setExportingFormat(null);
			}
		}

		window.addEventListener("message", handleMessage);
		return () => window.removeEventListener("message", handleMessage);
	}, [exportSourceUrl, onDownloadTracked, resource.slug, exportingFormat]);

	const handleExport = useCallback(
		(format: ResourceExportKind) => {
			const iframeWindow = iframeRef.current?.contentWindow;
			if (!iframeWindow || !exportReady) return;

			const option = RESOURCE_EXPORT_OPTIONS.find((item) => item.id === format);
			if (!option) return;

			setExportError("");
			setExportingFormat(format);
			iframeWindow.postMessage(
				{
					type: "REQUEST_EXPORT",
					requestId: `export-${format}-${crypto.randomUUID()}`,
					data: {
						format: option.editorFormat,
						filename: buildExportFilename(resource.title, format),
					},
				},
				window.location.origin,
			);
		},
		[exportReady, resource.title],
	);

	const handleDirectDownload = useCallback(() => {
		if (!firstFileUrl) return;
		const href = firstFileUrl;
		getApiClient()
			.then((api) => api.trackDownload(resource.slug, "direct"))
			.then((result) => {
				if (onDownloadTracked) onDownloadTracked(result.count, "direct");
			})
			.catch(() => {})
			.finally(() => {
				const a = document.createElement("a");
				a.href = href;
				a.download = "";
				a.style.display = "none";
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
			});
	}, [firstFileUrl, onDownloadTracked, resource.slug]);

	const editorUrl = exportSourceUrl
		? `${url("api/v1/exelearning-editor/index.html")}?elpxUrl=${encodeURIComponent(exportSourceUrl)}`
		: null;

	return (
		<>
			{/* Breadcrumb */}
			<nav className="breadcrumb">
				<a href={url("")}>{m.detail_home()}</a>
				<span className="sep">/</span>
				<a href={url("explorar")}>{m.detail_explore()}</a>
				<span className="sep">/</span>
				<span>{resource.title}</span>
			</nav>

			{/* Header */}
			<header className="detail-header">
				{/* Meta row: status badge + date */}
				<div className="detail-header-meta">
					<span className={getStatusBadgeClass(resource.editorialStatus)}>
						{status.label}
					</span>
					{updatedDate || publicationDate ? (
						<span className="detail-date">
							<span className="material-symbols-outlined">calendar_today</span>
							{updatedDate
								? m.detail_updated({ date: updatedDate })
								: m.detail_published_on({ date: publicationDate })}
						</span>
					) : null}
				</div>

				{/* Title */}
				<h1 className="detail-title">{resource.title}</h1>

				{/* Author + license row */}
				<div className="detail-author-row">
					<div className="detail-author">
						<div className="detail-author-avatar">{authorInitial}</div>
						<div>
							<p className="detail-author-name">{authorName}</p>
							{resource.publisher ? (
								<p className="detail-author-role">{resource.publisher}</p>
							) : null}
						</div>
					</div>
					<div
						style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}
					>
						{resource.license ? (
							<div className="detail-license">
								<span className="material-symbols-outlined">copyright</span>
								<span className="detail-license-text">{resource.license}</span>
							</div>
						) : null}
						{canEdit ? (
							<a href={url(`editar?id=${resource.id}`)} className="edit-btn">
								{m.detail_edit()}
							</a>
						) : null}
					</div>
				</div>
			</header>

			{/* Grid: left content + right sidebar */}
			<div className="detail-content">
				{/* Left column */}
				<div className="detail-main">
					{/* Action buttons */}
					<div className="detail-actions-bar">
						{hasPreview ? (
							<a
								href={previewUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="detail-action-primary"
							>
								<span className="material-symbols-outlined">visibility</span>
								{m.detail_view_online()}
							</a>
						) : null}
						<DownloadMenu
							hasDirectFile={Boolean(hasFiles && firstFileUrl)}
							hasExports={Boolean(editorUrl)}
							totalFileSize={totalFileSize}
							downloadCount={stats?.downloadCount ?? 0}
							exportCounts={stats?.exportCounts}
							exportReady={exportReady}
							exportingFormat={exportingFormat}
							onDirectDownload={handleDirectDownload}
							onExport={handleExport}
						/>
						{!hasPreview && !hasFiles && !editorUrl ? (
							<span
								style={{
									color: "var(--color-on-surface-variant)",
									fontSize: "var(--text-body-md)",
								}}
							>
								{m.detail_no_files()}
							</span>
						) : null}
						{exportError ? (
							<p className="detail-export-status" role="alert">
								{exportError}
							</p>
						) : null}
					</div>
					{editorUrl ? (
						<iframe
							ref={iframeRef}
							src={editorUrl}
							title="Exportador eXeLearning"
							aria-hidden="true"
							tabIndex={-1}
							className="detail-export-iframe"
						/>
					) : null}

					{/* Preview */}
					{hasPreview ? (
						<section className="elpx-preview-section">
							<h2>{m.detail_preview_title()}</h2>
							<div className="elpx-preview-wrapper">
								<iframe
									ref={previewIframeRef}
									src={previewUrl}
									className="elpx-preview-iframe"
									sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
									referrerPolicy="no-referrer"
									loading="lazy"
									title={m.detail_preview_iframe()}
								/>
							</div>
							<EmbedModal embed={activeEmbed} onClose={closeEmbed} />
						</section>
					) : null}

					{/* Embed / Ponlo en tu web */}
					{hasPreview ? (
						<EmbedSection
							title={resource.title}
							previewUrl={previewUrl}
							slug={resource.slug}
						/>
					) : null}

					{/* Description */}
					{resource.description ? (
						<section className="description-section">
							<h2>{m.detail_description()}</h2>
							<p>{resource.description}</p>
						</section>
					) : null}

					{/* Files */}
					{hasFiles ? (
						<section className="files-section">
							<h2>{m.detail_files()}</h2>
							<div className="files-grid">
								{mediaItems.map((mediaItem) => {
									const fileIcon = FILE_ICONS[mediaItem.mimeType || ""] ?? "📁";
									const size = mediaItem.fileSize
										? formatBytes(mediaItem.fileSize)
										: "";
									return (
										<a
											key={mediaItem.id}
											href={mediaItem.url}
											className="file-card"
											download
										>
											<span className="file-icon" aria-hidden="true">
												{fileIcon}
											</span>
											<div className="file-info">
												<span className="file-name">
													{mediaItem.filename || m.detail_file_default()}
												</span>
												{size ? (
													<span className="file-size">{size}</span>
												) : null}
											</div>
										</a>
									);
								})}
							</div>
						</section>
					) : null}

					{/* Ratings */}
					<section className="detail-ratings-section">
						<RatingIsland
							resourceSlug={resource.slug}
							currentUserId={currentUserId}
						/>
					</section>
				</div>

				{/* Right sidebar */}
				<aside className="detail-sidebar-col">
					<div className="detail-meta-card">
						{/* Technical details */}
						<div className="meta-section">
							<h3 className="meta-section-title">{m.detail_technical()}</h3>
							<div>
								{resource.resourceType ? (
									<div className="meta-row">
										<div className="meta-row-icon">
											<span className="material-symbols-outlined">
												category
											</span>
										</div>
										<div>
											<p className="meta-row-label">{m.detail_type()}</p>
											<p className="meta-row-value">{resource.resourceType}</p>
										</div>
									</div>
								) : null}

								{resource.language ? (
									<div className="meta-row">
										<div className="meta-row-icon">
											<span className="material-symbols-outlined">
												translate
											</span>
										</div>
										<div>
											<p className="meta-row-label">{m.detail_language()}</p>
											<p className="meta-row-value">{resource.language}</p>
										</div>
									</div>
								) : null}

								{resource.subjects?.length ? (
									<div className="meta-row">
										<div className="meta-row-icon">
											<span className="material-symbols-outlined">
												architecture
											</span>
										</div>
										<div>
											<p className="meta-row-label">{m.detail_subjects()}</p>
											<p className="meta-row-value">
												{resource.subjects.join(", ")}
											</p>
										</div>
									</div>
								) : null}

								{resource.levels?.length ? (
									<div className="meta-row">
										<div className="meta-row-icon">
											<span className="material-symbols-outlined">school</span>
										</div>
										<div>
											<p className="meta-row-label">{m.detail_levels()}</p>
											<p className="meta-row-value">
												{resource.levels.join(", ")}
											</p>
										</div>
									</div>
								) : null}

								{publicationDate ? (
									<div className="meta-row">
										<div className="meta-row-icon">
											<span className="material-symbols-outlined">event</span>
										</div>
										<div>
											<p className="meta-row-label">{m.detail_pub_date()}</p>
											<p className="meta-row-value">{publicationDate}</p>
										</div>
									</div>
								) : null}
							</div>
						</div>

						{/* Keywords / Tags */}
						{keywords.length > 0 ? (
							<div className="meta-section">
								<h3 className="meta-section-title">{m.detail_tags()}</h3>
								<div className="meta-tags">
									{keywords.map((keyword) => (
										<span key={keyword} className="meta-tag">
											{keyword}
										</span>
									))}
								</div>
							</div>
						) : null}

						{/* Actions: Favorite + Share + Report */}
						<div className="meta-section">
							<div className="meta-actions">
								<FavoriteIsland
									resourceSlug={resource.slug}
									initialFavorited={isFavorited}
									initialCount={stats?.favoriteCount ?? 0}
									currentUserId={currentUserId}
								/>
								<ShareButton />
								<ReportButton
									resourceSlug={resource.slug}
									currentUserId={currentUserId}
								/>
							</div>
						</div>
					</div>
				</aside>
			</div>

			{/* Related resources full-width (ADR-0036 / #72) */}
			{related && related.data.length > 0 ? (
				<RelatedResourcesSection
					headingId="related-resources-heading"
					title={m.detail_related_title()}
					description={m.detail_related_desc()}
					items={related.data}
				/>
			) : null}
			{related && related.sameAuthor.length > 0 ? (
				<RelatedResourcesSection
					headingId="same-author-heading"
					title={m.detail_same_author_title()}
					items={related.sameAuthor}
				/>
			) : null}
		</>
	);
}

interface ResourceStats {
	downloadCount: number;
	exportCounts?: {
		scorm: number;
		ims: number;
		web: number;
		epub: number;
	};
	favoriteCount: number;
	ratingAvg: number;
	ratingCount: number;
}

export function updateStatsAfterDownload(
	current: ResourceStats | null,
	count: number,
	format?: ResourceExportKind | "direct",
): ResourceStats | null {
	if (!current) return current;
	if (!format || format === "direct") {
		return { ...current, downloadCount: count };
	}

	const exportCounts = current.exportCounts ?? {
		scorm: 0,
		ims: 0,
		web: 0,
		epub: 0,
	};

	return {
		...current,
		downloadCount: count,
		exportCounts: {
			...exportCounts,
			[format]: exportCounts[format] + 1,
		},
	};
}

export function ResourceDetailIsland() {
	const [resource, setResource] = useState<Resource | null | undefined>(
		undefined,
	);
	const [session, setSession] = useState<SessionData | null>(null);
	const [stats, setStats] = useState<ResourceStats | null>(null);
	const [isFavorited, setIsFavorited] = useState(false);
	const [related, setRelated] = useState<RelatedResourcesResult | null>(null);
	const [error, setError] = useState("");

	useEffect(() => {
		const slug = new URLSearchParams(window.location.search).get("slug");
		if (!slug) {
			setResource(null);
			return;
		}

		void (async () => {
			try {
				const api = await getApiClient();
				const [nextResource, nextSession] = await Promise.all([
					api.getResourceBySlug(slug),
					api.getSession().catch(() => null),
				]);

				setResource(nextResource);
				setSession(nextSession);

				// Fetch social stats (includes userFavorited)
				if (nextResource) {
					api
						.getResourceStats(slug)
						.then((s) => {
							setStats(s);
							if ((s as Record<string, unknown>).userFavorited) {
								setIsFavorited(true);
							}
						})
						.catch(() => {});

					api
						.getRelatedResources(slug, { limit: 6 })
						.then((payload) => setRelated(payload))
						.catch(() => setRelated({ data: [], sameAuthor: [], limit: 6 }));
				}
			} catch {
				setError(m.detail_error());
				setResource(null);
			}
		})();
	}, []);

	if (resource === undefined && !error) {
		return (
			<div className="detail-page">
				<p className="loading">{m.detail_loading()}</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="detail-page">
				<p className="empty-state">
					{error} <a href={url("")}>{m.resource_back_home()}</a>
				</p>
			</div>
		);
	}

	if (resource === null) {
		return (
			<div className="detail-page">
				<p className="empty-state">
					{m.detail_not_found()} <a href={url("")}>{m.resource_back_home()}</a>
				</p>
			</div>
		);
	}

	return (
		<div className="detail-page">
			<ResourceDetailContent
				resource={resource as Resource}
				session={session}
				stats={stats}
				isFavorited={isFavorited}
				related={related}
				onDownloadTracked={(count, format) =>
					setStats((prev) => updateStatsAfterDownload(prev, count, format))
				}
			/>
		</div>
	);
}
