import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getApiClient } from "../lib/get-api-client.ts";
import { url } from "../lib/paths.ts";
import "../styles/nuevo.css";

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

  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const authorRef = useRef<HTMLInputElement>(null);
  const languageRef = useRef<HTMLSelectElement>(null);
  const licenseRef = useRef<HTMLSelectElement>(null);
  const resourceTypeRef = useRef<HTMLSelectElement>(null);
  const keywordsRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const storedElpxFileRef = useRef<File | null>(null);

  useEffect(() => {
    async function checkAuth() {
      try {
        const api = await getApiClient();
        const session = await api.getSession();
        if (!session?.user) { setShowAuthCheck(true); return; }
        const role = session.user.role ?? "reader";
        if (["reader"].includes(role)) { setShowAuthCheck(true); return; }
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

  async function handleSkipElpx() {
    setSkipBtnDisabled(true);
    setSkipBtnText("Creando…");
    try {
      const api = await getApiClient();
      const draft = await api.createDraftResource();
      navigate(url(`editar?id=${draft.id}&new=1`).replace(window.location.origin, ""));
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
      const metadata: Record<string, string> = result.metadata;
      const filename: string = result.filename;
      storedElpxFileRef.current = file;
      setShowElpxDrawer(false);
      setShowForm(true);
      if (metadata.title && titleRef.current) titleRef.current.value = metadata.title;
      if (metadata.description && descriptionRef.current) descriptionRef.current.value = metadata.description;
      if (metadata.author && authorRef.current) authorRef.current.value = metadata.author;
      if (metadata.language && languageRef.current) {
        const opt = languageRef.current.querySelector(`option[value="${metadata.language}"]`);
        if (opt) languageRef.current.value = metadata.language;
      }
      if (metadata.license && licenseRef.current) {
        const opt = licenseRef.current.querySelector(`option[value="${metadata.license}"]`);
        if (opt) licenseRef.current.value = metadata.license;
      }
      if (resourceTypeRef.current) resourceTypeRef.current.value = "actividad-interactiva";
      setElpxSuccessBanner(`Metadatos extraídos de ${filename || file.name}. Revisa y crea el recurso.`);
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
      title: titleRef.current?.value ?? "",
      description: descriptionRef.current?.value ?? "",
      language: languageRef.current?.value ?? "es",
      license: licenseRef.current?.value ?? "cc-by",
      resourceType: resourceTypeRef.current?.value ?? "documento",
      author: authorRef.current?.value || undefined,
      keywords: keywordsRef.current?.value || undefined,
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
        navigate(url(`editar?id=${data.id}`).replace(window.location.origin, ""));
      }, 500);
    } catch (err: unknown) {
      const e = err as { details?: { field: string; message: string }[]; error?: string };
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
          <span className="material-symbols-outlined" aria-hidden="true">lock</span>
          <p>Necesitas <a href={url("login")}>iniciar sesión</a> como autor o superior para crear recursos.</p>
        </div>
      )}

      {errorMsg && (
        <div className="new-resource-error" role="alert" aria-live="polite">{errorMsg}</div>
      )}
      {successMsg && (
        <div className="new-resource-success" role="status" aria-live="polite">{successMsg}</div>
      )}

      {showElpxDrawer && (
        <section className="elpx-drawer">
          <div className="elpx-drawer-content">
            <span className="material-symbols-outlined elpx-drawer-icon" aria-hidden="true">upload_file</span>
            <h2>Sube un archivo .elpx</h2>
            <p>Arrastra un archivo .elpx de eXeLearning para crear el recurso con sus metadatos automáticamente.</p>
            <div
              className={`elpx-dropzone${isDragover ? " is-dragover" : ""}`}
              tabIndex={0}
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
            </div>
            {elpxLoading && (
              <div className="elpx-loading">
                <span>Analizando archivo...</span>
              </div>
            )}
            {elpxError && (
              <div className="elpx-error" role="alert">{elpxError}</div>
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
              ref={titleRef}
              required
              aria-describedby="title-error"
              aria-invalid={invalidFields.has("title") ? "true" : undefined}
              placeholder="Nombre del recurso educativo"
            />
            <span id="title-error" className="field-error" role="alert">{fieldErrors.title ?? ""}</span>
          </div>

          <div className="form-field">
            <label htmlFor="description">Descripción *</label>
            <textarea
              id="description"
              ref={descriptionRef}
              rows={4}
              required
              aria-describedby="description-error"
              aria-invalid={invalidFields.has("description") ? "true" : undefined}
              placeholder="Describe el contenido, objetivos y destinatarios del recurso..."
            />
            <span id="description-error" className="field-error" role="alert">{fieldErrors.description ?? ""}</span>
          </div>

          <div className="form-row">
            <div className="form-field">
              <label htmlFor="language">Idioma *</label>
              <select
                id="language"
                ref={languageRef}
                required
                aria-describedby="language-error"
                aria-invalid={invalidFields.has("language") ? "true" : undefined}
              >
                <option value="es">Español</option>
                <option value="en">Inglés</option>
                <option value="ca">Catalán</option>
                <option value="eu">Euskera</option>
                <option value="gl">Gallego</option>
              </select>
              <span id="language-error" className="field-error" role="alert">{fieldErrors.language ?? ""}</span>
            </div>

            <div className="form-field">
              <label htmlFor="license">Licencia *</label>
              <select
                id="license"
                ref={licenseRef}
                required
                aria-describedby="license-error"
                aria-invalid={invalidFields.has("license") ? "true" : undefined}
              >
                <option value="cc-by">CC BY</option>
                <option value="cc-by-sa">CC BY-SA</option>
                <option value="cc-by-nc">CC BY-NC</option>
                <option value="cc-by-nc-sa">CC BY-NC-SA</option>
                <option value="cc0">CC0 (Dominio público)</option>
              </select>
              <span id="license-error" className="field-error" role="alert">{fieldErrors.license ?? ""}</span>
            </div>
          </div>

          <div className="form-field">
            <label htmlFor="resourceType">Tipo de recurso *</label>
            <select
              id="resourceType"
              ref={resourceTypeRef}
              required
              aria-describedby="resourceType-error"
              aria-invalid={invalidFields.has("resourceType") ? "true" : undefined}
            >
              <option value="documento">Documento</option>
              <option value="presentacion">Presentación</option>
              <option value="video">Vídeo</option>
              <option value="audio">Audio</option>
              <option value="imagen">Imagen</option>
              <option value="actividad-interactiva">Actividad interactiva</option>
              <option value="secuencia-didactica">Secuencia didáctica</option>
              <option value="ejercicio">Ejercicio</option>
              <option value="evaluacion">Evaluación</option>
              <option value="proyecto">Proyecto</option>
            </select>
            <span id="resourceType-error" className="field-error" role="alert">{fieldErrors.resourceType ?? ""}</span>
          </div>

          <div className="form-field">
            <label htmlFor="author">Autor</label>
            <input
              type="text"
              id="author"
              ref={authorRef}
              aria-describedby="author-error"
              placeholder="Nombre del autor"
            />
            <span id="author-error" className="field-error" role="alert">{fieldErrors.author ?? ""}</span>
          </div>

          <div className="form-field">
            <label htmlFor="keywords">Palabras clave (separadas por comas)</label>
            <input
              type="text"
              id="keywords"
              ref={keywordsRef}
              placeholder="matemáticas, fracciones, visual"
              aria-describedby="keywords-error"
            />
            <span id="keywords-error" className="field-error" role="alert">{fieldErrors.keywords ?? ""}</span>
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
