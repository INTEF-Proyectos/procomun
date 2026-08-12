import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { getApiClient } from "../lib/get-api-client.ts";
import { url } from "../lib/paths.ts";
import type { ResourceVersionRecord } from "../lib/resource-version-api.ts";

const RESTORE_ROLES = new Set(["curator", "admin"]);

function formatDate(value: ResourceVersionRecord["createdAt"]) {
	if (!value) return "";
	return new Date(value).toLocaleDateString("es-ES", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

export function ResourceVersionPanel() {
	const [searchParams] = useSearchParams();
	const resourceId = searchParams.get("id");
	const isNew = searchParams.get("new") === "1";
	const [target, setTarget] = useState<Element | null>(null);
	const [versions, setVersions] = useState<ResourceVersionRecord[]>([]);
	const [canRestore, setCanRestore] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		setTarget(document.querySelector(".edit-main"));
	}, []);

	useEffect(() => {
		if (!resourceId || isNew) return;
		let cancelled = false;

		async function load() {
			const api = await getApiClient();
			const [history, session] = await Promise.all([
				api.listResourceVersions(resourceId).catch(() => []),
				api.getSession().catch(() => null),
			]);
			if (cancelled) return;
			setVersions(history);
			setCanRestore(RESTORE_ROLES.has(session?.user?.role ?? ""));
		}

		void load();
		return () => {
			cancelled = true;
		};
	}, [resourceId, isNew]);

	if (!target || !resourceId || isNew) return null;

	async function restore(version: ResourceVersionRecord) {
		if (busy) return;
		const confirmed = window.confirm(
			`¿Restaurar la versión ${version.versionNumber}? Se creará una nueva versión y el historial se conservará.`,
		);
		if (!confirmed) return;

		setBusy(true);
		setError("");
		try {
			const api = await getApiClient();
			const result = await api.restoreResourceVersion(resourceId, version.id);
			if (!result.ok) {
				setError(result.error ?? "Error al restaurar la versión");
				return;
			}
			window.location.reload();
		} catch {
			setError("Error al restaurar la versión");
		} finally {
			setBusy(false);
		}
	}

	return createPortal(
		<div className="edit-files-section" id="edit-versions-panel">
			<h3>Historial de versiones</h3>
			{error && (
				<div className="edit-msg edit-msg-error" role="alert">
					{error}
				</div>
			)}
			{versions.length === 0 ? (
				<p className="edit-drop-hint">
					Aún no hay versiones. Se creará una automáticamente al generar,
					guardar o subir un nuevo archivo .elpx.
				</p>
			) : (
				<ul className="edit-media-list" data-versions-list>
					{versions.map((version) => (
						<li key={version.id}>
							<strong>v{version.versionNumber}</strong>{" "}
							{version.isCurrent && (
								<span className="edit-badge edit-badge-published">
									Vigente
								</span>
							)}{" "}
							<span className="edit-date">{formatDate(version.createdAt)}</span>
							{version.createdByName && <span> — {version.createdByName}</span>}{" "}
							{version.downloadUrl && (
								<a
									href={url(version.downloadUrl.replace(/^\//, ""))}
									download={version.originalFilename ?? undefined}
								>
									Descargar
								</a>
							)}{" "}
							{!version.isCurrent && canRestore && (
								<button
									type="button"
									className="edit-wf-btn-outline"
									onClick={() => void restore(version)}
									disabled={busy}
								>
									Restaurar
								</button>
							)}
						</li>
					))}
				</ul>
			)}
		</div>,
		target,
	);
}
