import { canManageResource } from "@procomun/db/validation";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	RelatedResource,
	RelatedResourcesResult,
	Resource,
	SessionData,
} from "../../lib/api-client.ts";
import {
	publisherProfileId,
	splitAuthorNames,
} from "../../lib/author-links.ts";
import { getApiClient } from "../../lib/get-api-client.ts";
import {
	knowledgeAreaHref,
	professionalFamilyHref,
} from "../../lib/knowledge-area-field.ts";
import { getBaseUrl, url } from "../../lib/paths.ts";
import {
	FILE_ICONS,
	formatBytes,
	languageLabel,
	resourceTypeLabel,
	searchHref,
	statusLabelOf,
} from "../../lib/resource-display.ts";
import {
	buildExportFilename,
	getResourceElpxFileUrl,
	RESOURCE_EXPORT_OPTIONS,
	type ResourceExportKind,
} from "../../lib/resource-export.ts";
import type { ResourceSummary } from "../../lib/types/resource-extended.ts";
import { trackViewOnce } from "../../lib/view-tracking.ts";
import { AuthorSearchLinks, PublisherLink } from "../../ui/AuthorLinks.tsx";
import { LicenseBadge } from "../../ui/LicenseBadge.tsx";
import { ResourceCard } from "../../ui/ResourceCard.tsx";
import { FavoriteIsland } from "../social/FavoriteIsland.tsx";
import { RatingIsland } from "../social/RatingIsland.tsx";
import { ReportButton } from "../social/ReportButton.tsx";
import {
	CatalogValueList,
	EducationalClassificationList,
	SearchValue,
	SearchValueList,
} from "./EducationalClassificationList.tsx";
import "../../lib/paraglide-client.ts";
import { configuredEmbedMode } from "../../lib/embed-mode.ts";
import {
	buildPublicEmbedIframeCode,
	CONTENT_IFRAME_SANDBOX,
} from "../../lib/embed-sandbox.ts";
import * as m from "../../paraglide/messages.js";
import { getLocale } from "../../paraglide/runtime.js";

/**
 * Bridge compartido de eXeLearning (lado padre): UN artefacto vendorizado desde el
 * core de eXeLearning, que es el canónico (eXe ADR-0021). Antes eran tres ficheros
 * copiados desde mod_exelearning; ahora es un bundle cuyos bytes se verifican contra
 * el manifest publicado, así que la divergencia deja de ser algo que un chequeo
 * pueda pasar por alto y pasa a ser inexpresable.
 *
 * Publica window.exeEmbedRelay (overlay promote-to-parent de vídeos/PDF cross-origin)
 * y window.exeMediaHost (host del iDevice de vídeo interactivo). Sustituye al sistema
 * bespoke (EmbedModal + use-elpx-embed-relay + elpx-embed-policy).
 */
type ExeBridgeWindow = Window & {
	exeEmbedRelay?: {
		init: (config: {
			mode: "open" | "strict";
			whitelist?: string[];
		}) => unknown;
	};
	exeMediaHost?: {
		attach: (
			iframe: HTMLIFrameElement,
			opts: Record<string, unknown>,
		) => { detach: () => void };
	};
	__exeEmbedRelayReady?: boolean;
	__exeBridgeLoader?: Promise<void>;
};

// Carga un <script> clásico una sola vez (los ficheros vendorizados exponen
// globals en window y no son módulos ES). Resuelve cuando el script ha cargado.
function loadScriptOnce(src: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>(
			`script[data-exe-bridge="${src}"]`,
		);
		if (existing) {
			if (existing.dataset.loaded === "1") {
				resolve();
				return;
			}
			existing.addEventListener("load", () => resolve());
			existing.addEventListener("error", () =>
				reject(new Error(`No se pudo cargar ${src}`)),
			);
			return;
		}
		const script = document.createElement("script");
		script.src = src;
		// Encadenamos secuencialmente, pero async=false preserva además el orden
		// relativo entre estos scripts si el navegador los agrupa.
		script.async = false;
		script.dataset.exeBridge = src;
		script.addEventListener("load", () => {
			script.dataset.loaded = "1";
			resolve();
		});
		script.addEventListener("error", () =>
			reject(new Error(`No se pudo cargar ${src}`)),
		);
		document.head.appendChild(script);
	});
}

// UN solo artefacto vendorizado (elpx/exe_external_media/), construido y publicado
// por el core de eXeLearning, que sustituye a los tres ficheros que se cargaban
// encadenados: la policy, el relay de embeds y el host de medios. Ya no hay orden
// que respetar, porque ya no hay globals que uno lea del otro en tiempo de carga.
//
// El core es canónico (eXe ADR-0021): este repo guarda los BYTES y los verifica
// contra el manifest publicado, en vez de una copia de la lógica que pueda
// divergir. No lo parchees aquí — una edición local es invisible aguas arriba, se
// sobrescribe al re-vendorizar, y falla `verify.mjs` en CI mientras tanto.
//
// Se cachea la promesa para que múltiples montajes reutilicen la misma carga. Si
// falla, se limpia para que un remount pueda reintentar (p. ej. tras un glitch de
// red o un 404 temporal del estático).
function loadElpxBridge(): Promise<void> {
	const w = window as unknown as ExeBridgeWindow;
	if (!w.__exeBridgeLoader) {
		const base = getBaseUrl();
		w.__exeBridgeLoader = loadScriptOnce(
			`${base}elpx/exe_external_media/exe-external-media-host.min.js`,
		).catch((err: unknown) => {
			w.__exeBridgeLoader = undefined;
			throw err;
		});
	}
	return w.__exeBridgeLoader;
}

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
		elpxPreview: item.elpxPreview ?? null,
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
}) {
	const [copiedEmbed, setCopiedEmbed] = useState(false);
	const fullUrl =
		typeof window !== "undefined"
			? new URL(previewUrl, window.location.origin).href
			: previewUrl;
	const iframeCode = buildPublicEmbedIframeCode(title, fullUrl);

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

export function ResourceDetailContent({
	resource,
	session,
	stats,
	isFavorited,
	related,
	onDownloadTracked,
	onPreviewOpened,
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
	/** Se llama al cargar la vista previa o pulsar «Ver online» (#421). */
	onPreviewOpened?: () => void;
}) {
	const status = statusLabelOf(resource.editorialStatus);
	// #448: igual que con las palabras clave, las áreas del catálogo mandan y
	// las materias en texto libre de origen solo salen si no hay ninguna.
	const knowledgeAreas = resource.knowledgeAreas ?? [];
	const professionalFamilies = resource.professionalFamilies ?? [];
	// ADR-0042: el catálogo manda; sin él se muestran las etiquetas de origen.
	const catalogKeywords = resource.catalogKeywords ?? [];
	const keywords =
		catalogKeywords.length === 0 && resource.keywords
			? resource.keywords
					.split(",")
					.map((keyword) => keyword.trim())
					.filter(Boolean)
			: [];
	const publicationDate = resourceDate(resource.createdAt);
	const updatedDate = resourceDate(resource.updatedAt);
	const currentUserId = session?.user?.id ?? null;
	const canEdit = !!session?.user && canManageResource(session.user, resource);
	// #458: quien publica (cuenta) lleva a su ficha; los autores del texto
	// libre, a una búsqueda con su nombre. Los importados no tienen cuenta.
	const publisherId =
		resource.createdBy && resource.createdByName ? resource.createdBy : null;
	// La ficha de autor solo existe con algún recurso publicado (#487): en la
	// vista previa de uno sin publicar el nombre va sin enlace, porque la cuenta
	// puede no tener ninguno y el enlace daría 404.
	// Tampoco con la cuenta dada de baja (#541): su ficha no existe.
	const publisherHref =
		resource.editorialStatus === "published"
			? publisherProfileId(resource)
			: null;
	const authorNames = splitAuthorNames(resource.author);
	// Sin cuenta (p. ej. importados) va primero el publicador y la lista de
	// autores debajo (#457); con cuenta, la cuenta, la autoría y el publicador.
	const publisherFirst = !publisherId && !!resource.publisher;
	const authorName =
		(publisherId && resource.createdByName) ||
		(publisherFirst && resource.publisher) ||
		authorNames[0] ||
		m.detail_unknown_author();
	const authorInitial = authorName.charAt(0).toUpperCase();
	// Se derivan los valores, no solo los booleanos: un `hasPreview: boolean` no
	// permite a TypeScript estrechar `resource.elpxPreview` en los usos, y menos
	// dentro de un closure. Con el valor ya extraído, el narrowing es real.
	// El visor sale de `previewUrl`, no de que haya `elpxPreview`: un paquete
	// con screenshot.png y sin index.html tiene miniatura, pero no visor (#471).
	const previewUrl = resource.elpxPreview?.previewUrl ?? undefined;
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
	// Preview iframe: el bridge compartido de eXeLearning (lado padre) superpone
	// los players de vídeo/PDF cross-origin sobre el contenido de origen opaco y
	// puentea el iDevice de vídeo interactivo. Paridad con mod_exelearning/wp/omeka.
	const previewIframeRef = useRef<HTMLIFrameElement | null>(null);
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

	// Conecta el bridge compartido de eXeLearning al iframe de preview: carga los
	// scripts vendorizados (policy → relay → host) y, ya montado el iframe,
	// inicializa el relay (overlay de vídeos/PDF cross-origin) una vez por página y
	// engancha el host de vídeo interactivo a este iframe. El relay valida cada
	// embed por sí mismo y pinta el overlay inline (sin modal React).
	useEffect(() => {
		if (!previewUrl) return;
		const iframe = previewIframeRef.current;
		if (!iframe) return;

		let detach: (() => void) | undefined;
		let cancelled = false;

		void loadElpxBridge()
			.then(() => {
				if (cancelled) return;
				const w = window as unknown as ExeBridgeWindow;
				// El relay es global a la página: se inicializa una sola vez (registra
				// listeners de message/scroll/resize y resuelve el iframe de contenido
				// por identidad de ventana en cada mensaje).
				if (w.exeEmbedRelay && !w.__exeEmbedRelayReady) {
					w.exeEmbedRelay.init({ mode: configuredEmbedMode() });
					w.__exeEmbedRelayReady = true;
				}
				// El host de vídeo interactivo es por-iframe: se engancha al montar y se
				// desengancha al desmontar.
				if (w.exeMediaHost) {
					detach = w.exeMediaHost.attach(iframe, {}).detach;
				}
			})
			.catch(() => {
				/* carga del bridge fallida: la preview sigue funcionando sin overlay */
			});

		return () => {
			cancelled = true;
			if (detach) detach();
		};
	}, [previewUrl]);

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
						<div className="detail-author-avatar" aria-hidden="true">
							{authorInitial}
						</div>
						<div>
							<p className="detail-author-name">
								{publisherHref ? (
									<PublisherLink id={publisherHref} name={authorName} />
								) : publisherId ? (
									authorName
								) : publisherFirst ? (
									resource.publisher
								) : authorNames.length > 0 ? (
									<AuthorSearchLinks author={resource.author} />
								) : (
									authorName
								)}
							</p>
							{publisherId && authorNames.length > 0 ? (
								<p className="detail-author-role">
									{m.detail_authors_label()}{" "}
									<AuthorSearchLinks author={resource.author} />
								</p>
							) : null}
							{publisherFirst && authorNames.length > 0 ? (
								<p className="detail-author-role">
									<AuthorSearchLinks author={resource.author} />
								</p>
							) : null}
							{publisherId && resource.publisher ? (
								<p className="detail-author-role">{resource.publisher}</p>
							) : null}
						</div>
					</div>
					<div
						style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}
					>
						{resource.license ? (
							<div className="detail-license">
								<LicenseBadge license={resource.license} />
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
								onClick={onPreviewOpened}
							>
								<span className="material-symbols-outlined">visibility</span>
								{m.detail_view_online()}
							</a>
						) : null}
						{hasFiles && firstFileUrl ? (
							<a
								href={firstFileUrl}
								download
								className="detail-action-outline"
								onClick={(e) => {
									e.preventDefault();
									const href = firstFileUrl;
									getApiClient()
										.then((api) => api.trackDownload(resource.slug, "direct"))
										.then((result) => {
											if (onDownloadTracked)
												onDownloadTracked(result.count, "direct");
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
								}}
							>
								<span className="material-symbols-outlined">download</span>
								{m.detail_download()}
								{totalFileSize > 0 ? ` (${formatBytes(totalFileSize)})` : ""}
								{stats?.downloadCount ? (
									<span className="detail-action-count">
										{stats.downloadCount}
									</span>
								) : null}
							</a>
						) : null}
						{!hasPreview && !hasFiles ? (
							<span
								style={{
									color: "var(--color-on-surface-variant)",
									fontSize: "var(--text-body-md)",
								}}
							>
								{m.detail_no_files()}
							</span>
						) : null}
						{editorUrl ? (
							<div className="detail-export-group">
								<span className="detail-export-label">Exportar como</span>
								<div className="detail-export-buttons">
									{RESOURCE_EXPORT_OPTIONS.map((option) => (
										<button
											key={option.id}
											type="button"
											className="detail-export-pill"
											onClick={() => handleExport(option.id)}
											disabled={!exportReady || exportingFormat !== null}
										>
											{exportingFormat === option.id
												? `Preparando ${option.label}...`
												: option.label}
											{stats?.exportCounts?.[option.id] ? (
												<span className="detail-action-count">
													{stats.exportCounts[option.id]}
												</span>
											) : null}
										</button>
									))}
								</div>
								{exportError ? (
									<p className="detail-export-status" role="alert">
										{exportError}
									</p>
								) : null}
							</div>
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
									sandbox={CONTENT_IFRAME_SANDBOX}
									referrerPolicy="no-referrer"
									loading="lazy"
									title={m.detail_preview_iframe()}
									onLoad={onPreviewOpened}
								/>
							</div>
						</section>
					) : null}

					{/* Embed / Ponlo en tu web: solo lo publicado (#466). La vista
					    previa de un borrador es un enlace firmado que caduca. */}
					{hasPreview && resource.editorialStatus === "published" ? (
						<EmbedSection title={resource.title} previewUrl={previewUrl} />
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

					{/* Ratings: solo en publicados (#461) */}
					{resource.editorialStatus === "published" ? (
						<section className="detail-ratings-section">
							{typeof stats?.viewCount === "number" ? (
								<p className="detail-views">
									<span
										className="material-symbols-outlined"
										aria-hidden="true"
									>
										visibility
									</span>
									{stats.viewCount === 1
										? m.detail_views_one()
										: m.detail_views_other({ count: String(stats.viewCount) })}
								</p>
							) : null}
							<RatingIsland
								slug={resource.slug}
								currentUserId={currentUserId}
							/>
						</section>
					) : null}
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
											<p className="meta-row-value">
												<SearchValue
													value={resourceTypeLabel(resource.resourceType)}
												/>
											</p>
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
											<p className="meta-row-value">
												<SearchValue value={languageLabel(resource.language)} />
											</p>
										</div>
									</div>
								) : null}

								{knowledgeAreas.length > 0 ? (
									<div className="meta-row">
										<div className="meta-row-icon">
											<span className="material-symbols-outlined">
												architecture
											</span>
										</div>
										<div>
											<p className="meta-row-label">
												{m.knowledge_areas_label()}
											</p>
											<p className="meta-row-value">
												<CatalogValueList
													values={knowledgeAreas}
													href={knowledgeAreaHref}
												/>
											</p>
										</div>
									</div>
								) : resource.subjects?.length ? (
									<div className="meta-row">
										<div className="meta-row-icon">
											<span className="material-symbols-outlined">
												architecture
											</span>
										</div>
										<div>
											<p className="meta-row-label">{m.detail_subjects()}</p>
											<p className="meta-row-value">
												<SearchValueList values={resource.subjects} />
											</p>
										</div>
									</div>
								) : null}

								{professionalFamilies.length > 0 ? (
									<div className="meta-row">
										<div className="meta-row-icon">
											<span className="material-symbols-outlined">work</span>
										</div>
										<div>
											<p className="meta-row-label">
												{m.detail_professional_families()}
											</p>
											<p className="meta-row-value">
												<CatalogValueList
													values={professionalFamilies}
													href={professionalFamilyHref}
												/>
											</p>
										</div>
									</div>
								) : null}

								{resource.otherAuthors?.trim() ? (
									<div className="meta-row">
										<div className="meta-row-icon">
											<span className="material-symbols-outlined">group</span>
										</div>
										<div>
											<p className="meta-row-label">
												{m.detail_other_authors()}
											</p>
											<p className="meta-row-value">{resource.otherAuthors}</p>
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
						{catalogKeywords.length > 0 || keywords.length > 0 ? (
							<div className="meta-section">
								<h3 className="meta-section-title">{m.detail_tags()}</h3>
								<div className="meta-tags">
									{catalogKeywords.map((keyword) => (
										<a
											key={keyword.id}
											className="meta-tag"
											href={url(
												`explorar?tag=${encodeURIComponent(keyword.slug)}`,
											)}
										>
											{keyword.label}
										</a>
									))}
									{keywords.map((keyword) => (
										<a
											key={keyword}
											className="meta-tag"
											href={searchHref(keyword)}
										>
											{keyword}
										</a>
									))}
								</div>
							</div>
						) : null}

						<EducationalClassificationList areas={resource.educationalAreas} />

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
									target="resource"
									slug={resource.slug}
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
	viewCount?: number;
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
				onPreviewOpened={() => {
					const current = resource as Resource;
					if (current.editorialStatus !== "published") return;
					void (async () => {
						const api = await getApiClient();
						const viewCount = await trackViewOnce(
							current.slug,
							(slug, sessionId) => api.trackResourceView(slug, sessionId),
						);
						if (viewCount !== null) {
							setStats((prev) => (prev ? { ...prev, viewCount } : prev));
						}
					})();
				}}
			/>
		</div>
	);
}
