import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	LANGUAGE_OPTIONS,
	LICENSE_OPTIONS,
	RESOURCE_TYPE_OPTIONS,
} from "../islands/resources/resource-form-options.ts";
import { getApiClient } from "../lib/get-api-client.ts";
import { url } from "../lib/paths.ts";
import "../styles/nuevo.css";

interface ResourceFormState {
	title: string;
	description: string;
	author: string;
	language: string;
	license: string;
	resourceType: string;
	keywords: string;
}

interface ElpxMetadata {
	title?: string;
	description?: string;
	author?: string;
	language?: string;
	license?: string;
}

const EMPTY_FORM: ResourceFormState = {
	title: "",
	description: "",
	author: "",
	language: "es",
	license: "cc-by",
	resourceType: "documento",
	keywords: "",
};

const ALLOWED_LANGUAGES = new Set(
	LANGUAGE_OPTIONS.map((option) => option.value),
);
const ALLOWED_LICENSES = new Set(LICENSE_OPTIONS.map((option) => option.value));

export function applyElpxMetadataToForm(
	current: ResourceFormState,
	metadata: ElpxMetadata,
): ResourceFormState {
	return {
		...current,
		title: metadata.title || current.title,
		description: metadata.description || current.description,
		author: metadata.author || current.author,
		language:
			metadata.language && ALLOWED_LANGUAGES.has(metadata.language)
				? metadata.language
				: current.language,
		license:
			metadata.license && ALLOWED_LICENSES.has(metadata.license)
				? metadata.license
				: current.license,
		resourceType: "actividad-interactiva",
	};
}

export default function NuevoPage() {
	const navigate = useNavigate();

	const [showAuthCheck, setShowAuthCheck] = useState(false);
	const [showElpxDrawer, setShowElpxDrawer] = useState(false);
	const [showForm, setShowForm] = useState(false);
	const [errorMsg, setErrorMsg] = useState("");
	const [successMsg, setSuccessMsg] = useState("");
	const [elpxSuccessBanner, setElpxSuccessBanner] = useState("");
	const [elpxLoading, setElpxLoading] = useState(false);
	const [elpxError, setElpxError] = useState("");
	const [isDragover, setIsDragover] = useState(false);
	const [skipBtnDisabled, setSkipBtnDisabled] = useState(false);
	const [skipBtnText, setSkipBtnText] = useState("Crear recurso manualmente");
	const [submitBtnDisabled, setSubmitBtnDisabled] = useState(false);
	const [submitBtnText, setSubmitBtnText] = useState("Crear recurso");
	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
	const [invalidFields, setInvalidFields] = useState<Set<string>>(new Set());
	const [form, setForm] = useState<ResourceFormState>(EMPTY_FORM);

	const fileInputRef = useRef<HTMLInputElement>(null);
	const storedElpxFileRef = useRef<File | null>(null);

	useEffect(() => {
		async function checkAuth() {
			try {
				const api = await getApiClient();
				const session = await api.getSession();
				if (!session?.user) {
					setShowAuthCheck(true);
					return;
				}
				const role = session.user.role ?? "reader";
				if (["reader"].includes(role)) {
					setShowAuthCheck(true);
					return;
				}
				setShowElpxDrawer(true);
			} catch {
				setShowAuthCheck(true);
			}
		}
		checkAuth();
	}, []);

	function clearFieldErrors() {
		setFieldErrors({});
		setInvalidFields(new Set());
	}

	function showFieldErrors(details: { field: string; message: string }[]) {
		const errs: Record<string, string> = {};
		const invalid = new Set<string>();
		for (const err of details) {
			errs[err.field] = err.message;
			invalid.add(err.field);
		}
		setFieldErrors(errs);
		setInvalidFields(invalid);
	}

	function setFieldValue(field: keyof ResourceFormState, value: string) {
		setForm((current) => ({ ...current, [field]: value }));
		setFieldErrors((current) => ({ ...current, [field]: "" }));
		setInvalidFields((current) => {
			const next = new Set(current);
			next.delete(field);
			return next;
		});
	}

	async function handleSkipElpx() {
		setSkipBtnDisabled(true);
		setSkipBtnText("Creando…");
		try {
			const api = await getApiClient();
			const draft = await api.createDraftResource();
			navigate(
				url(`editar?id=${draft.id}&new=1`).replace(window.location.origin, ""),
			);
		} catch {
			setSkipBtnDisabled(false);
			setSkipBtnText("Crear recurso manualmente");
		}
	}

	async function handleElpxFile(file: File) {
		setElpxLoading(true);
		setElpxError("");
		try {
			const formData = new FormData();
			formData.append("file", file);
			const res = await fetch(url("api/admin/elpx/analyze"), {
				method: "POST",
				credentials: "include",
				body: formData,
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({ error: "Error" }));
				setElpxError(err.error);
				return;
			}
			const result = await res.json();
			const metadata: ElpxMetadata = result.metadata;
			const filename: string = result.filename;
			storedElpxFileRef.current = file;
			setForm((current) => applyElpxMetadataToForm(current, metadata));
			setShowElpxDrawer(false);
			setShowForm(true);
			setElpxSuccessBanner(
				`Metadatos extraídos de ${filename || file.name}. Revisa y crea el recurso.`,
			);
		} catch {
			setElpxError("Error al analizar el archivo");
		} finally {
			setElpxLoading(false);
		}
	}

	function handleFileInputChange() {
		const f = fileInputRef.current?.files?.[0];
		if (f) handleElpxFile(f);
	}

	function handleDragOver(e: React.DragEvent) {
		e.preventDefault();
		setIsDragover(true);
	}

	function handleDragLeave() {
		setIsDragover(false);
	}

	function handleDrop(e: React.DragEvent) {
		e.preventDefault();
		setIsDragover(false);
		const f = e.dataTransfer?.files[0];
		if (f) handleElpxFile(f);
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setErrorMsg("");
		setSuccessMsg("");
		clearFieldErrors();

		const body = {
			title: form.title,
			description: form.description,
			language: form.language,
			license: form.license,
			resourceType: form.resourceType,
			author: form.author || undefined,
			keywords: form.keywords || undefined,
		};

		setSubmitBtnDisabled(true);
		setSubmitBtnText("Creando recurso…");

		try {
			const api = await getApiClient();
			const data = await api.createResource(body);
			if (storedElpxFileRef.current) {
				setSubmitBtnText("Subiendo archivo .elpx…");
				const uploadForm = new FormData();
				uploadForm.append("file", storedElpxFileRef.current);
				await fetch(url(`api/admin/elpx/upload/${data.id}`), {
					method: "POST",
					credentials: "include",
					body: uploadForm,
				});
			}
			setSuccessMsg("Recurso creado. Redirigiendo…");
			setTimeout(() => {
				navigate(
					url(`editar?id=${data.id}`).replace(window.location.origin, ""),
				);
			}, 500);
		} catch (err: unknown) {
			const e = err as {
				details?: { field: string; message: string }[];
				error?: string;
			};
			if (e?.details) showFieldErrors(e.details);
			setErrorMsg(e?.error ?? "Error al crear el recurso");
		} finally {
			setSubmitBtnDisabled(false);
			setSubmitBtnText("Crear recurso");
		}
	}

	return (
		<div className="new-resource-page">
			<h1 className="new-resource-title">Crear recurso</h1>

			{showAuthCheck && (
				<div className="new-resource-auth-msg">
					<span className="material-symbols-outlined" aria-hidden="true">
						lock
					</span>
					<p>
						Necesitas <a href={url("login")}>iniciar sesión</a> como autor o
						superior para crear recursos.
					</p>
				</div>
			)}

			{errorMsg && (
				<div className="new-resource-error" role="alert" aria-live="polite">
					{errorMsg}
				</div>
			)}
			{successMsg && (
				<div className="new-resource-success" role="status" aria-live="polite">
					{successMsg}
				</div>
			)}

			{showElpxDrawer && (
				<section className="elpx-drawer">
					<div className="elpx-drawer-content">
						<span
							className="material-symbols-outlined elpx-drawer-icon"
							aria-hidden="true"
						>
							upload_file
						</span>
						<h2>Sube un archivo .elpx</h2>
						<p>
							Arrastra un archivo .elpx de eXeLearning para crear el recurso con
							sus metadatos automáticamente.
						</p>
						<section
							aria-label="Zona para arrastrar el archivo .elpx"
							className={`elpx-dropzone${isDragover ? " is-dragover" : ""}`}
							onDragOver={handleDragOver}
							onDragLeave={handleDragLeave}
							onDrop={handleDrop}
						>
							<label className="elpx-file-label">
								<span>Seleccionar archivo .elpx</span>
								<input
									type="file"
									ref={fileInputRef}
									accept=".elpx,.elp"
									onChange={handleFileInputChange}
								/>
							</label>
							<p className="elpx-drop-hint">o arrastra aquí</p>
						</section>
						{elpxLoading && (
							<div className="elpx-loading">
								<span>Analizando archivo...</span>
							</div>
						)}
						{elpxError && (
							<div className="elpx-error" role="alert">
								{elpxError}
							</div>
						)}
						<button
							type="button"
							className="skip-link"
							disabled={skipBtnDisabled}
							onClick={handleSkipElpx}
						>
							{skipBtnText}
						</button>
					</div>
				</section>
			)}

			{elpxSuccessBanner && (
				<div className="elpx-success-banner">{elpxSuccessBanner}</div>
			)}

			{showForm && (
				<form className="new-resource-form" onSubmit={handleSubmit} noValidate>
					<div className="form-field">
						<label htmlFor="title">Título *</label>
						<input
							type="text"
							id="title"
							required
							aria-describedby="title-error"
							aria-invalid={invalidFields.has("title") ? "true" : undefined}
							placeholder="Nombre del recurso educativo"
							value={form.title}
							onChange={(event) =>
								setFieldValue("title", event.currentTarget.value)
							}
						/>
						<span id="title-error" className="field-error" role="alert">
							{fieldErrors.title ?? ""}
						</span>
					</div>

					<div className="form-field">
						<label htmlFor="description">Descripción *</label>
						<textarea
							id="description"
							rows={4}
							required
							aria-describedby="description-error"
							aria-invalid={
								invalidFields.has("description") ? "true" : undefined
							}
							placeholder="Describe el contenido, objetivos y destinatarios del recurso..."
							value={form.description}
							onChange={(event) =>
								setFieldValue("description", event.currentTarget.value)
							}
						/>
						<span id="description-error" className="field-error" role="alert">
							{fieldErrors.description ?? ""}
						</span>
					</div>

					<div className="form-row">
						<div className="form-field">
							<label htmlFor="language">Idioma *</label>
							<select
								id="language"
								required
								aria-describedby="language-error"
								aria-invalid={
									invalidFields.has("language") ? "true" : undefined
								}
								value={form.language}
								onChange={(event) =>
									setFieldValue("language", event.currentTarget.value)
								}
							>
								<option value="es">Español</option>
								<option value="en">Inglés</option>
								<option value="ca">Catalán</option>
								<option value="eu">Euskera</option>
								<option value="gl">Gallego</option>
							</select>
							<span id="language-error" className="field-error" role="alert">
								{fieldErrors.language ?? ""}
							</span>
						</div>

						<div className="form-field">
							<label htmlFor="license">Licencia *</label>
							<select
								id="license"
								required
								aria-describedby="license-error"
								aria-invalid={invalidFields.has("license") ? "true" : undefined}
								value={form.license}
								onChange={(event) =>
									setFieldValue("license", event.currentTarget.value)
								}
							>
								<option value="cc-by">CC BY</option>
								<option value="cc-by-sa">CC BY-SA</option>
								<option value="cc-by-nc">CC BY-NC</option>
								<option value="cc-by-nc-sa">CC BY-NC-SA</option>
								<option value="cc0">CC0 (Dominio público)</option>
							</select>
							<span id="license-error" className="field-error" role="alert">
								{fieldErrors.license ?? ""}
							</span>
						</div>
					</div>

					<div className="form-field">
						<label htmlFor="resourceType">Tipo de recurso *</label>
						<select
							id="resourceType"
							required
							aria-describedby="resourceType-error"
							aria-invalid={
								invalidFields.has("resourceType") ? "true" : undefined
							}
							value={form.resourceType}
							onChange={(event) =>
								setFieldValue("resourceType", event.currentTarget.value)
							}
						>
							{RESOURCE_TYPE_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
						<span id="resourceType-error" className="field-error" role="alert">
							{fieldErrors.resourceType ?? ""}
						</span>
					</div>

					<div className="form-field">
						<label htmlFor="author">Autor</label>
						<input
							type="text"
							id="author"
							aria-describedby="author-error"
							placeholder="Nombre del autor"
							value={form.author}
							onChange={(event) =>
								setFieldValue("author", event.currentTarget.value)
							}
						/>
						<span id="author-error" className="field-error" role="alert">
							{fieldErrors.author ?? ""}
						</span>
					</div>

					<div className="form-field">
						<label htmlFor="keywords">
							Palabras clave (separadas por comas)
						</label>
						<input
							type="text"
							id="keywords"
							placeholder="matemáticas, fracciones, visual"
							aria-describedby="keywords-error"
							value={form.keywords}
							onChange={(event) =>
								setFieldValue("keywords", event.currentTarget.value)
							}
						/>
						<span id="keywords-error" className="field-error" role="alert">
							{fieldErrors.keywords ?? ""}
						</span>
					</div>

					<button
						type="submit"
						id="submit-btn"
						className="form-submit"
						disabled={submitBtnDisabled}
					>
						{submitBtnText}
					</button>
				</form>
			)}
		</div>
	);
}
