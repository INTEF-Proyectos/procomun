import {
	MAX_OTHER_AUTHORS_LENGTH,
	validateCreateResource,
	validateUpdateResource,
} from "@procomun/db/validation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { EducationalClassificationEditor } from "../islands/resources/EducationalClassificationFields.tsx";
import { KeywordCatalogField } from "../islands/resources/KeywordCatalogField.tsx";
import { getResourceTypeOptions } from "../islands/resources/resource-form-options.ts";
import type {
	CatalogKeyword,
	Resource,
	SessionUser,
} from "../lib/api-client.ts";
import {
	assignmentsToSelections,
	type EducationalSelection,
	selectionsToAssignments,
} from "../lib/educational-classification.ts";
import { getApiClient } from "../lib/get-api-client.ts";
import { url } from "../lib/paths.ts";
import { hasMinRole } from "../lib/shared-utils.ts";
import {
	DeleteResourceAction,
	deleteResourceRedirectPath,
} from "./DeleteResourceAction.tsx";
import { ResourceVersionPanel } from "./ResourceVersionPanel.tsx";
import "../styles/editar.css";

const STATUS_LABELS: Record<string, { label: string; cssClass: string }> = {
	draft: { label: "Borrador", cssClass: "edit-badge-draft" },
	review: { label: "En revisión", cssClass: "edit-badge-review" },
	published: { label: "Publicado", cssClass: "edit-badge-published" },
	archived: { label: "Archivado", cssClass: "edit-badge-archived" },
};

const TRANSITION_RULES: Record<
	string,
	{
		to: string;
		label: string;
		icon: string;
		cssClass: string;
		minRole: string;
	}[]
> = {
	draft: [
		{
			to: "review",
			label: "Enviar a revisión",
			icon: "rate_review",
			cssClass: "edit-wf-btn-gold",
			minRole: "author",
		},
		{
			to: "published",
			label: "Publicar directamente",
			icon: "check_circle",
			cssClass: "edit-wf-btn-green",
			minRole: "editor",
		},
	],
	review: [
		{
			to: "draft",
			label: "Devolver a borrador",
			icon: "undo",
			cssClass: "edit-wf-btn-outline",
			minRole: "curator",
		},
		{
			to: "published",
			label: "Publicar",
			icon: "check_circle",
			cssClass: "edit-wf-btn-green",
			minRole: "curator",
		},
	],
	published: [
		{
			to: "archived",
			label: "Archivar",
			icon: "archive",
			cssClass: "edit-wf-btn-outline",
			minRole: "curator",
		},
	],
	archived: [
		{
			to: "draft",
			label: "Restaurar a borrador",
			icon: "restore",
			cssClass: "edit-wf-btn-outline",
			minRole: "curator",
		},
	],
};

const ROLE_LEVELS: Record<string, number> = {
	reader: 0,
	author: 1,
	editor: 2,
	curator: 3,
	admin: 4,
};

type ElpxProject = {
	hash: string;
	elpxFileUrl: string | null;
	originalFilename: string;
	hasPreview: boolean | number;
	previewUrl: string | null;
	metadata: {
		title: string;
		description: string;
		author: string;
		license: string;
		language: string;
	} | null;
} | null;

function formatDate(d: string | number | Date | null | undefined) {
	if (!d) return "";
	return new Date(d).toLocaleDateString("es-ES", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

export default function EditarPage() {
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const resourceId = searchParams.get("id");
	const isNew = searchParams.get("new") === "1";

	const [state, setState] = useState<"loading" | "auth" | "notfound" | "ready">(
		"loading",
	);
	const [resource, setResource] = useState<Resource | null>(null);
	const [elpx, setElpx] = useState<ElpxProject>(null);
	const [userRole, setUserRole] = useState("reader");
	const [catalogKeywords, setCatalogKeywords] = useState<CatalogKeyword[]>([]);
	const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);
	const [errorMsg, setErrorMsg] = useState("");
	const [successMsg, setSuccessMsg] = useState("");
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
	const [saveBtnDisabled, setSaveBtnDisabled] = useState(false);
	const [saveBtnText, setSaveBtnText] = useState(
		isNew ? "Crear recurso" : "Guardar cambios",
	);
	const [applyMetaDone, setApplyMetaDone] = useState(false);
	const [educationalSelections, setEducationalSelections] = useState<
		EducationalSelection[]
	>([]);

	// eXeLearning editor state
	const [exeModalVisible, setExeModalVisible] = useState(false);
	const [exeStatus, setExeStatus] = useState("Cargando...");
	const [exeSaveBtnDisabled, setExeSaveBtnDisabled] = useState(true);
	const [exeSavingOverlayVisible, setExeSavingOverlayVisible] = useState(false);

	const exeReadyRef = useRef(false);
	const exeSavingRef = useRef(false);
	const exeHasChangesRef = useRef(false);
	const exeElpxHashRef = useRef<string | null>(null);
	const exeElpxFileUrlRef = useRef<string | null>(null);
	const exeElpxFilenameRef = useRef<string | null>(null);
	const exeResourceIdRef = useRef<string | null>(null);
	const reqCounterRef = useRef(0);
	const exeIframeRef = useRef<HTMLIFrameElement>(null);

	// Form field refs
	const titleRef = useRef<HTMLInputElement>(null);
	const descriptionRef = useRef<HTMLTextAreaElement>(null);
	const authorRef = useRef<HTMLInputElement>(null);
	const otherAuthorsRef = useRef<HTMLInputElement>(null);
	const languageRef = useRef<HTMLSelectElement>(null);
	const licenseRef = useRef<HTMLSelectElement>(null);
	const resourceTypeRef = useRef<HTMLSelectElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const dropzoneRef = useRef<HTMLElement>(null);
	const uploadStatusRef = useRef<HTMLDivElement>(null);

	const nextReqId = useCallback((p: string) => {
		return `${p}-${Date.now()}-${++reqCounterRef.current}`;
	}, []);

	const postToExe = useCallback(
		(msg: Record<string, unknown>, transferables?: Transferable[]) => {
			exeIframeRef.current?.contentWindow?.postMessage(
				msg,
				"*",
				transferables ?? [],
			);
		},
		[],
	);

	const closeExeEditor = useCallback((force = false) => {
		if (
			exeHasChangesRef.current &&
			!force &&
			!confirm("Hay cambios sin guardar. ¿Cerrar?")
		)
			return;
		setExeModalVisible(false);
		document.body.style.overflow = "";
		// Reset iframe src to stop the editor
		if (exeIframeRef.current) {
			exeIframeRef.current.src = "about:blank";
		}
		exeHasChangesRef.current = false;
	}, []);

	const handleExeSave = useCallback(
		async (payload: {
			bytes: ArrayBuffer;
			filename: string;
			mimeType: string;
		}) => {
			exeSavingRef.current = true;
			setExeSaveBtnDisabled(true);
			setExeStatus("Guardando...");
			setExeSavingOverlayVisible(true);
			try {
				const blob = new Blob([payload.bytes], {
					type: payload.mimeType || "application/zip",
				});
				const fd = new FormData();
				fd.append("file", blob, payload.filename || "project.elpx");
				const res = await fetch(
					url(`api/admin/elpx/save/${exeResourceIdRef.current}`),
					{
						method: "POST",
						credentials: "include",
						body: fd,
					},
				);
				if (!res.ok) throw new Error("Error al guardar");
				postToExe({
					type: "WP_SAVE_CONFIRMED",
					requestId: nextReqId("confirmed"),
				});
				exeHasChangesRef.current = false;
				setExeStatus("Guardado");
				setExeSavingOverlayVisible(false);
				setTimeout(() => {
					closeExeEditor(true);
					window.location.reload();
				}, 800);
			} catch (err) {
				setExeStatus(`Error: ${(err as Error).message}`);
				setExeSaveBtnDisabled(false);
				setExeSavingOverlayVisible(false);
			} finally {
				exeSavingRef.current = false;
			}
		},
		[postToExe, nextReqId, closeExeEditor],
	);

	const handleExeMessage = useCallback(
		(event: MessageEvent) => {
			if (
				!event.data?.type ||
				event.source !== exeIframeRef.current?.contentWindow
			)
				return;
			switch (event.data.type) {
				case "EXELEARNING_READY":
					exeReadyRef.current = true;
					setExeStatus("Editor listo");
					postToExe({
						type: "CONFIGURE",
						requestId: nextReqId("cfg"),
						data: {
							hideUI: { fileMenu: true, saveButton: true, userMenu: true },
						},
					});
					break;
				case "DOCUMENT_LOADED":
					setExeStatus("Documento cargado");
					setExeSaveBtnDisabled(false);
					break;
				case "DOCUMENT_CHANGED":
					exeHasChangesRef.current = true;
					setExeStatus("Cambios sin guardar");
					setExeSaveBtnDisabled(false);
					break;
				case "WP_SAVE_FILE":
					if (event.data.bytes)
						handleExeSave(
							event.data as {
								bytes: ArrayBuffer;
								filename: string;
								mimeType: string;
							},
						);
					break;
				case "WP_REQUEST_SAVE_ERROR":
					setExeStatus(`Error: ${event.data.error}`);
					setExeSaveBtnDisabled(false);
					exeSavingRef.current = false;
					setExeSavingOverlayVisible(false);
					break;
			}
		},
		[postToExe, nextReqId, handleExeSave],
	);

	useEffect(() => {
		window.addEventListener("message", handleExeMessage);
		return () => window.removeEventListener("message", handleExeMessage);
	}, [handleExeMessage]);

	useEffect(() => {
		function handleBeforeUnload(e: BeforeUnloadEvent) {
			if (exeHasChangesRef.current && exeModalVisible) e.preventDefault();
		}
		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => window.removeEventListener("beforeunload", handleBeforeUnload);
	}, [exeModalVisible]);

	useEffect(() => {
		if (!resourceId) {
			setState("notfound");
			return;
		}
		// Capturado tras la guarda: dentro de `init` (un closure) el narrowing
		// del `if` de arriba ya no aplica.
		const id = resourceId;

		async function init() {
			try {
				const api = await getApiClient();
				const [session, resourceData] = await Promise.all([
					api.getSession().catch(() => null),
					api.getResourceById(id).catch(() => null),
				]);

				if (!session?.user) {
					setState("auth");
					return;
				}
				if (!resourceData) {
					setState("notfound");
					return;
				}

				const role = session.user.role ?? "reader";
				const level = ROLE_LEVELS[role] ?? 0;
				if (level < 1) {
					setState("auth");
					return;
				}

				const elpxData = await api.getElpxProject(id).catch(() => null);
				if (elpxData?.hasPreview && elpxData.previewUrl) {
					resourceData.elpxPreview = {
						hash: elpxData.hash,
						previewUrl: elpxData.previewUrl,
					};
				}

				setResource(resourceData);
				setCatalogKeywords(resourceData.catalogKeywords ?? []);
				setEducationalSelections(
					assignmentsToSelections(resourceData.educationalAreas),
				);
				setElpx(elpxData);
				setUserRole(role);
				setSessionUser(session.user);
				setState("ready");

				// Initialize multi-file uploader after state settles
				setTimeout(async () => {
					const uploadPanel = document.getElementById("edit-multiupload-panel");
					if (uploadPanel) {
						const { initResourceUploader } = await import(
							"../lib/resource-uploader.ts"
						);
						await initResourceUploader({
							resourceId: id,
							root: uploadPanel,
							api,
							onUploadComplete: isNew
								? undefined
								: async (count) => {
										const statusEl =
											document.getElementById("elpx-auto-status");
										if (!statusEl) return;
										statusEl.textContent = "Generando paquete .elpx...";
										statusEl.className =
											"edit-upload-status edit-upload-loading";
										statusEl.style.display = "block";
										try {
											const result = await api.generateElpx(id);
											statusEl.textContent =
												count > 0
													? `${count} archivo${count !== 1 ? "s" : ""} subido${count !== 1 ? "s" : ""}. Paquete .elpx actualizado.`
													: "Paquete .elpx actualizado.";
											statusEl.className =
												"edit-upload-status edit-upload-success";
											setTimeout(() => {
												statusEl.style.display = "none";
											}, 5000);

											// Refresh the preview iframe with the new URL so deleted
											// files disappear without a full page reload (DEF-008).
											const iframe = document.querySelector<HTMLIFrameElement>(
												".edit-preview-iframe",
											);
											if (iframe && result.previewUrl) {
												iframe.src = result.previewUrl;
											} else if (iframe && !result.previewUrl) {
												// No preview available anymore – hide the section
												const section = iframe.closest(".edit-preview-section");
												if (section)
													(section as HTMLElement).style.display = "none";
											}
										} catch (err) {
											statusEl.textContent = `Error al generar .elpx: ${(err as Error).message || "Error desconocido"}`;
											statusEl.className =
												"edit-upload-status edit-upload-error";
										}
									},
						});
					}
				}, 0);
			} catch {
				setState("notfound");
			}
		}

		init();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [resourceId, isNew]);

	async function handleFormSubmit(e: React.FormEvent) {
		e.preventDefault();
		// El formulario solo se renderiza con state === "ready", que implica
		// resource != null, pero TypeScript no puede correlacionar ambos estados.
		if (!resource) return;
		setErrorMsg("");
		setSuccessMsg("");
		setFieldErrors({});

		const author = authorRef.current?.value ?? "";
		const payload = {
			title: titleRef.current?.value ?? "",
			description: descriptionRef.current?.value ?? "",
			language: languageRef.current?.value ?? "es",
			license: licenseRef.current?.value ?? "cc-by",
			resourceType: resourceTypeRef.current?.value ?? "documento",
			// Al crear el autor es obligatorio y uno existente no se puede borrar,
			// pero un recurso antiguo sin autor se sigue guardando sin él.
			author: isNew || resource.author || author.trim() ? author : undefined,
			// Opcional (issue #417): se envía siempre para poder vaciarlo.
			otherAuthors: otherAuthorsRef.current?.value ?? "",
			keywordIds: catalogKeywords.map((keyword) => keyword.id),
			educationalAreas: selectionsToAssignments(educationalSelections),
		};
		const validation = isNew
			? validateCreateResource(payload)
			: validateUpdateResource(payload);
		if (!validation.valid) {
			const errs: Record<string, string> = {};
			for (const detail of validation.errors) {
				errs[detail.field] = detail.message;
			}
			setFieldErrors(errs);
			setErrorMsg("Revisa los campos marcados");
			return;
		}

		setSaveBtnDisabled(true);
		setSaveBtnText("Guardando...");

		try {
			const api = await getApiClient();
			const result = await api.updateResource(resource.id, payload);

			if (!result.ok) {
				if (result.details) {
					const errs: Record<string, string> = {};
					result.details.forEach((d: { field: string; message: string }) => {
						errs[d.field] = d.message;
					});
					setFieldErrors(errs);
				}
				setErrorMsg(result.error ?? "Error al guardar");
				return;
			}

			if (isNew) {
				setSaveBtnText("Generando .elpx...");
				await api.generateElpx(resource.id);
				navigate(
					url(`editar?id=${resource.id}`).replace(window.location.origin, ""),
				);
				return;
			}

			setSuccessMsg("Cambios guardados correctamente");
			setTimeout(() => setSuccessMsg(""), 3000);
		} catch {
			setErrorMsg("Error de conexión");
		} finally {
			setSaveBtnDisabled(false);
			setSaveBtnText(isNew ? "Crear recurso" : "Guardar cambios");
		}
	}

	async function handleWorkflowBtn(newStatus: string) {
		if (!resource) return;
		setErrorMsg("");
		setSuccessMsg("");
		try {
			const api = await getApiClient();
			await api.updateResourceStatus(resource.id, newStatus);
			setSuccessMsg(
				`Estado actualizado a "${STATUS_LABELS[newStatus]?.label ?? newStatus}"`,
			);
			setTimeout(() => window.location.reload(), 800);
		} catch {
			setErrorMsg("Error al cambiar el estado");
		}
	}

	function handleApplyElpxMeta() {
		if (!elpx?.metadata) return;
		const m = elpx.metadata;
		if (m.title && titleRef.current) titleRef.current.value = m.title;
		if (m.description && descriptionRef.current)
			descriptionRef.current.value = m.description;
		if (m.author && authorRef.current) authorRef.current.value = m.author;
		if (m.language && languageRef.current) {
			const opt = languageRef.current.querySelector(
				`option[value="${m.language}"]`,
			);
			if (opt) languageRef.current.value = m.language;
		}
		if (m.license && licenseRef.current) {
			const opt = licenseRef.current.querySelector(
				`option[value="${m.license}"]`,
			);
			if (opt) licenseRef.current.value = m.license;
		}
		setApplyMetaDone(true);
	}

	function openExeEditor(
		resId: string,
		elpxHash: string | null,
		elpxFileUrl: string | null,
		elpxFilename: string | null,
	) {
		exeResourceIdRef.current = resId;
		exeElpxHashRef.current = elpxHash;
		exeElpxFileUrlRef.current = elpxFileUrl;
		exeElpxFilenameRef.current = elpxFilename;
		exeReadyRef.current = false;
		exeSavingRef.current = false;
		exeHasChangesRef.current = false;
		setExeSaveBtnDisabled(true);
		setExeStatus("Cargando editor...");
		setExeModalVisible(true);
		document.body.style.overflow = "hidden";

		const editorPage = url("api/v1/exelearning-editor/index.html");
		const elpxParam = elpxFileUrl ? encodeURIComponent(elpxFileUrl) : "";
		if (exeIframeRef.current) {
			exeIframeRef.current.src = `${editorPage}?elpxUrl=${elpxParam}&resourceId=${resId}`;
		}
	}

	function handleExeSaveBtnClick() {
		if (exeSavingRef.current || !exeReadyRef.current) return;
		exeSavingRef.current = true;
		setExeSaveBtnDisabled(true);
		setExeStatus("Exportando...");
		setExeSavingOverlayVisible(true);
		postToExe({ type: "WP_REQUEST_SAVE", requestId: nextReqId("export") });
	}

	async function handleFileUpload(file: File) {
		if (!resource) return;
		const statusEl = uploadStatusRef.current;
		if (!statusEl) return;
		statusEl.textContent = "Subiendo archivo...";
		statusEl.className = "edit-upload-status edit-upload-loading";
		statusEl.style.display = "block";
		try {
			const formData = new FormData();
			formData.append("file", file);
			const res = await fetch(url(`api/admin/elpx/upload/${resource.id}`), {
				method: "POST",
				credentials: "include",
				body: formData,
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(
					(err as Record<string, string>).error || "Error al subir",
				);
			}
			statusEl.textContent = `Archivo "${file.name}" subido correctamente. Recargando...`;
			statusEl.className = "edit-upload-status edit-upload-success";
			setTimeout(() => window.location.reload(), 1000);
		} catch (err) {
			statusEl.textContent = `Error: ${(err as Error).message || "No se pudo subir el archivo"}`;
			statusEl.className = "edit-upload-status edit-upload-error";
		}
	}

	if (state === "loading") {
		return (
			<div id="edit-page" className="edit-page">
				<div className="edit-loading">Cargando recurso...</div>
			</div>
		);
	}

	if (state === "auth") {
		return (
			<div id="edit-page" className="edit-page">
				<div className="edit-auth">
					<span className="material-symbols-outlined" aria-hidden="true">
						lock
					</span>
					<p>
						Necesitas <a href={url("login")}>iniciar sesión</a> para editar
						recursos.
					</p>
				</div>
			</div>
		);
	}

	if (state === "notfound") {
		return (
			<div id="edit-page" className="edit-page">
				<div className="edit-auth">
					<span className="material-symbols-outlined" aria-hidden="true">
						search_off
					</span>
					<p>
						Recurso no encontrado. <a href="/">Volver al inicio</a>
					</p>
				</div>
			</div>
		);
	}

	// state === "ready"
	// state solo pasa a "ready" después de setResource(), pero eso TypeScript no
	// lo sabe: la guarda lo hace explícito en vez de afirmarlo con `!`.
	if (!resource) return null;
	const res = resource;
	const resourceTypeOptions = getResourceTypeOptions(
		isNew ? null : res.resourceType,
	);
	const authorRequired = isNew || Boolean(res.author);
	const st =
		STATUS_LABELS[res.editorialStatus] ??
		STATUS_LABELS.draft ??
		({ label: res.editorialStatus, cssClass: "" } as const);
	const date = formatDate(res.updatedAt || res.createdAt);
	const previewUrl = res.elpxPreview?.previewUrl ?? "";
	const userLevel = ROLE_LEVELS[userRole] ?? 0;
	const isAutoGenerated = elpx?.originalFilename === "recurso-generado.elpx";
	const showMultiUpload = isNew || !elpx || isAutoGenerated;
	const showDirectUpload = !isNew && elpx !== null && !isAutoGenerated;

	const transitions = TRANSITION_RULES[res.editorialStatus] ?? [];
	const allowedTransitions = transitions.filter(
		(t) => userLevel >= (ROLE_LEVELS[t.minRole] ?? 99),
	);

	return (
		<>
			<div id="edit-page" className="edit-page">
				{/* Header */}
				<div className="edit-header">
					<div className="edit-header-top">
						<span className={`edit-badge ${st.cssClass}`}>{st.label}</span>
						{date && (
							<span className="edit-date">
								<span className="material-symbols-outlined">
									calendar_today
								</span>
								{date}
							</span>
						)}
					</div>
					<a href={url(`recurso?slug=${res.slug}`)} className="edit-view-link">
						<span className="material-symbols-outlined">visibility</span>
						Ver ficha pública
					</a>
				</div>

				{errorMsg && (
					<div className="edit-msg edit-msg-error" role="alert">
						{errorMsg}
					</div>
				)}
				{successMsg && (
					<div className="edit-msg edit-msg-success" role="status">
						{successMsg}
					</div>
				)}

				<form className="edit-grid" onSubmit={handleFormSubmit} noValidate>
					{/* Left column */}
					<div className="edit-main">
						<div className="edit-field edit-field-title">
							<label htmlFor="ed-title">Título</label>
							<input
								type="text"
								id="ed-title"
								ref={titleRef}
								defaultValue={isNew ? "" : res.title}
								required
								placeholder="Título del recurso"
								aria-invalid={fieldErrors.title ? "true" : undefined}
							/>
							<span id="ed-title-error" className="edit-field-error">
								{fieldErrors.title ?? ""}
							</span>
						</div>

						{previewUrl && (
							<div className="edit-preview-section">
								<div className="edit-preview-header">
									<h3>Previsualización</h3>
									<button
										type="button"
										className="edit-exe-btn"
										onClick={async () => {
											try {
												const api = await getApiClient();
												const elpxData = await api.getElpxProject(res.id);
												if (elpxData) {
													openExeEditor(
														res.id,
														elpxData.hash,
														elpxData.elpxFileUrl,
														elpxData.originalFilename,
													);
												}
											} catch {
												// ignore
											}
										}}
									>
										<span className="material-symbols-outlined">edit_note</span>
										Editar en eXeLearning
									</button>
								</div>
								<div className="edit-preview-wrapper">
									<iframe
										src={previewUrl}
										className="edit-preview-iframe"
										sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
										loading="lazy"
										title="Vista previa"
									/>
								</div>
							</div>
						)}

						{/* Multi-file uploader */}
						{showMultiUpload && (
							<div id="edit-multiupload-panel" className="edit-files-section">
								<h3>Archivos adjuntos</h3>
								<div
									data-upload-dropzone
									className="edit-dropzone"
									id="edit-multi-dropzone"
								>
									<label className="edit-file-label">
										<span className="material-symbols-outlined">
											upload_file
										</span>
										<span>Seleccionar archivos</span>
										<input data-upload-input type="file" multiple />
									</label>
									<p className="edit-drop-hint">
										o arrastra aquí (PDF, DOCX, imágenes, vídeo…)
									</p>
								</div>
								<div
									data-upload-feedback
									className="edit-upload-status"
									aria-live="polite"
								></div>
								<div className="edit-upload-progress-row">
									<progress
										data-global-progress
										max={100}
										value={0}
										style={{ width: "100%" }}
									/>
									<span
										data-global-progress-label
										style={{ fontSize: "0.85rem", color: "#555" }}
									>
										Sin subidas activas
									</span>
								</div>
								<ul data-upload-queue className="edit-upload-queue">
									<li style={{ color: "#888", fontSize: "0.9rem" }}>
										No hay archivos en cola.
									</li>
								</ul>
								<ul data-persisted-uploads style={{ display: "none" }} />
								<div className="edit-files-list-header">
									<span>Archivos del recurso</span>
								</div>
								<ul data-media-list className="edit-media-list">
									<li style={{ color: "#888", fontSize: "0.9rem" }}>
										No hay archivos adjuntos todavía.
									</li>
								</ul>
								<div
									id="elpx-auto-status"
									className="edit-upload-status"
									style={{ display: "none" }}
									aria-live="polite"
								/>
							</div>
						)}

						{/* Direct .elpx upload */}
						{showDirectUpload && (
							<div className="edit-upload-section">
								<h3>
									{previewUrl
										? "Actualizar archivo .elpx"
										: "Subir archivo .elpx directamente"}
								</h3>
								<section
									ref={dropzoneRef}
									aria-label="Zona para arrastrar el archivo .elpx"
									className="edit-dropzone"
									onDragOver={(e) => {
										e.preventDefault();
										dropzoneRef.current?.classList.add("is-dragover");
									}}
									onDragLeave={() => {
										dropzoneRef.current?.classList.remove("is-dragover");
									}}
									onDrop={(e) => {
										e.preventDefault();
										dropzoneRef.current?.classList.remove("is-dragover");
										const f = e.dataTransfer?.files[0];
										if (f) handleFileUpload(f);
									}}
								>
									<label className="edit-file-label">
										<span className="material-symbols-outlined">
											upload_file
										</span>
										<span>Seleccionar archivo .elpx</span>
										<input
											type="file"
											id="edit-file-input"
											ref={fileInputRef}
											accept=".elpx,.elp"
											onChange={() => {
												const f = fileInputRef.current?.files?.[0];
												if (f) handleFileUpload(f);
											}}
										/>
									</label>
									<p className="edit-drop-hint">o arrastra aquí</p>
								</section>
								<div
									ref={uploadStatusRef}
									id="edit-upload-status"
									className="edit-upload-status"
									style={{ display: "none" }}
								/>
							</div>
						)}

						<div className="edit-field">
							<label htmlFor="ed-description">Descripción</label>
							<textarea
								id="ed-description"
								ref={descriptionRef}
								rows={6}
								required
								placeholder="Describe el contenido, objetivos y destinatarios..."
								defaultValue={isNew ? "" : res.description}
								aria-invalid={fieldErrors.description ? "true" : undefined}
							/>
							<span id="ed-description-error" className="edit-field-error">
								{fieldErrors.description ?? ""}
							</span>
						</div>

						{isNew && (
							<>
								<div className="edit-form-row">
									<div className="edit-field">
										<label htmlFor="ed-language">Idioma</label>
										<select
											id="ed-language"
											ref={languageRef}
											defaultValue="es"
										>
											<option value="es">Español</option>
											<option value="en">Inglés</option>
											<option value="ca">Catalán</option>
											<option value="eu">Euskera</option>
											<option value="gl">Gallego</option>
										</select>
									</div>
									<div className="edit-field">
										<label htmlFor="ed-license">Licencia</label>
										<select
											id="ed-license"
											ref={licenseRef}
											defaultValue="cc-by"
										>
											<option value="cc-by">CC BY</option>
											<option value="cc-by-sa">CC BY-SA</option>
											<option value="cc-by-nc">CC BY-NC</option>
											<option value="cc-by-nc-sa">CC BY-NC-SA</option>
											<option value="cc0">CC0</option>
										</select>
									</div>
								</div>
								<div className="edit-field">
									<label htmlFor="ed-resourceType">Tipo de recurso</label>
									<select
										id="ed-resourceType"
										ref={resourceTypeRef}
										defaultValue="actividad-interactiva"
									>
										{resourceTypeOptions.map((option) => (
											<option key={option.value} value={option.value}>
												{option.label}
											</option>
										))}
									</select>
								</div>
							</>
						)}

						<div className="edit-field">
							<label htmlFor="ed-author">
								{authorRequired ? "Autor *" : "Autor"}
							</label>
							<input
								type="text"
								id="ed-author"
								ref={authorRef}
								required={authorRequired}
								aria-describedby="ed-author-error"
								aria-invalid={fieldErrors.author ? "true" : undefined}
								defaultValue={res.author ?? ""}
								placeholder="Nombre del autor"
							/>
							<span id="ed-author-error" className="edit-field-error">
								{fieldErrors.author ?? ""}
							</span>
						</div>

						<div className="edit-field">
							<label htmlFor="ed-other-authors">
								Otros autores (opcional, separados por comas)
							</label>
							<input
								type="text"
								id="ed-other-authors"
								ref={otherAuthorsRef}
								maxLength={MAX_OTHER_AUTHORS_LENGTH}
								aria-describedby="ed-other-authors-error"
								aria-invalid={fieldErrors.otherAuthors ? "true" : undefined}
								defaultValue={res.otherAuthors ?? ""}
							/>
							<span id="ed-other-authors-error" className="edit-field-error">
								{fieldErrors.otherAuthors ?? ""}
							</span>
						</div>

						<EducationalClassificationEditor
							idPrefix="ed-educational"
							selections={educationalSelections}
							onChange={setEducationalSelections}
						/>

						<div className="edit-field">
							<KeywordCatalogField
								id="ed-keywords"
								selected={catalogKeywords}
								onChange={setCatalogKeywords}
								canCreate={hasMinRole(userRole, "curator")}
							/>
						</div>

						<ResourceVersionPanel />
					</div>

					{/* Right sidebar */}
					<aside className="edit-sidebar">
						<div className="edit-sidebar-card">
							<h3 className="edit-sidebar-title">Acciones</h3>
							<button
								type="submit"
								className="edit-save-btn"
								disabled={saveBtnDisabled}
							>
								<span className="material-symbols-outlined">save</span>
								{saveBtnText}
							</button>
							{allowedTransitions.length > 0 && (
								<div className="edit-wf-actions">
									{allowedTransitions.map((t) => (
										<button
											key={t.to}
											type="button"
											className={`edit-wf-btn ${t.cssClass}`}
											onClick={() => handleWorkflowBtn(t.to)}
										>
											<span className="material-symbols-outlined">
												{t.icon}
											</span>
											{t.label}
										</button>
									))}
								</div>
							)}
							{elpx?.metadata &&
								(elpx.metadata.title || elpx.metadata.description) && (
									<button
										type="button"
										className="edit-wf-btn edit-wf-btn-outline"
										disabled={applyMetaDone}
										onClick={handleApplyElpxMeta}
									>
										<span className="material-symbols-outlined">
											{applyMetaDone ? "check" : "auto_awesome"}
										</span>
										{applyMetaDone
											? "Metadatos aplicados"
											: "Aplicar metadatos del .elpx"}
									</button>
								)}
							{!isNew && (
								<DeleteResourceAction
									user={sessionUser}
									resource={res}
									onDeleted={() =>
										navigate(
											url(deleteResourceRedirectPath(userRole)).replace(
												window.location.origin,
												"",
											),
										)
									}
								/>
							)}
						</div>

						{/* Metadata card — hidden in creation mode */}
						{!isNew && (
							<div className="edit-sidebar-card">
								<h3 className="edit-sidebar-title">Metadatos</h3>

								<div className="edit-field">
									<label htmlFor="ed-language">Idioma</label>
									<select
										id="ed-language"
										ref={languageRef}
										defaultValue={res.language ?? "es"}
									>
										<option value="es">Español</option>
										<option value="en">Inglés</option>
										<option value="ca">Catalán</option>
										<option value="eu">Euskera</option>
										<option value="gl">Gallego</option>
									</select>
								</div>

								<div className="edit-field">
									<label htmlFor="ed-license">Licencia</label>
									<select
										id="ed-license"
										ref={licenseRef}
										defaultValue={res.license ?? "cc-by"}
									>
										<option value="cc-by">CC BY</option>
										<option value="cc-by-sa">CC BY-SA</option>
										<option value="cc-by-nc">CC BY-NC</option>
										<option value="cc-by-nc-sa">CC BY-NC-SA</option>
										<option value="cc0">CC0</option>
									</select>
								</div>

								<div className="edit-field">
									<label htmlFor="ed-resourceType">Tipo de recurso</label>
									<select
										id="ed-resourceType"
										ref={resourceTypeRef}
										defaultValue={res.resourceType ?? "documento"}
									>
										{resourceTypeOptions.map((option) => (
											<option key={option.value} value={option.value}>
												{option.label}
											</option>
										))}
									</select>
								</div>
							</div>
						)}
					</aside>
				</form>
			</div>

			{/* eXeLearning editor modal */}
			<div
				id="exe-editor-modal"
				className="exe-modal"
				style={{ display: exeModalVisible ? "flex" : "none" }}
			>
				<div className="exe-modal-bar">
					<div className="exe-modal-bar-left">
						<span className="material-symbols-outlined" aria-hidden="true">
							edit_note
						</span>
						<span className="exe-modal-title">Editor eXeLearning</span>
						<span className="exe-modal-status">{exeStatus}</span>
					</div>
					<div className="exe-modal-bar-right">
						<button
							type="button"
							className="exe-save-btn"
							disabled={exeSaveBtnDisabled}
							onClick={handleExeSaveBtnClick}
						>
							<span className="material-symbols-outlined">save</span>
							Guardar
						</button>
						<button
							type="button"
							className="exe-close-btn"
							onClick={() => closeExeEditor()}
						>
							<span className="material-symbols-outlined">close</span>
						</button>
					</div>
				</div>
				<iframe
					id="exe-iframe"
					ref={exeIframeRef}
					className="exe-modal-iframe"
					src="about:blank"
					title="Editor eXeLearning"
				/>
				{exeSavingOverlayVisible && (
					<div className="exe-saving-overlay">
						<span>Guardando cambios...</span>
					</div>
				)}
			</div>
		</>
	);
}
