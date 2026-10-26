import { canManageResource } from "@procomun/db/validation";
import { useState } from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog } from "../islands/shared/ConfirmDialog.tsx";
import type { ApiClient, Resource, SessionUser } from "../lib/api-client.ts";
import { getApiClient } from "../lib/get-api-client.ts";
import { hasMinRole } from "../lib/shared-utils.ts";

/** Texto de la confirmación: nombra el recurso para evitar borrados por error. */
export function deleteResourceMessage(title: string): string {
	return `¿Seguro que deseas eliminar «${title}»? Se borra el recurso completo y esta acción no se puede deshacer.`;
}

/**
 * Destino tras borrar desde la edición: curator y admin vuelven al listado de
 * Administrar, donde está el otro «Eliminar»; el autor, a sus recursos del perfil.
 */
export function deleteResourceRedirectPath(role: string | null | undefined) {
	return hasMinRole(role ?? undefined, "curator")
		? "admin?section=resources"
		: "perfil";
}

/** Mismo borrado que Administrar (`DELETE /api/admin/resources/:id`). */
export async function removeResource(
	api: Pick<ApiClient, "deleteResource">,
	id: string,
): Promise<void> {
	await api.deleteResource(id);
}

interface DeleteResourceActionProps {
	user: SessionUser | null;
	resource: Resource;
	onDeleted: () => void;
}

/**
 * Botón «Eliminar recurso» de la pantalla de edición (#393). Solo aparece para
 * quien puede borrar el recurso: la misma regla (`canManageResource`) que usa el
 * «Eliminar» de Administrar y que aplica la API.
 */
export function DeleteResourceAction({
	user,
	resource,
	onDeleted,
}: DeleteResourceActionProps) {
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	if (!user || !canManageResource(user, resource)) return null;

	async function handleConfirm() {
		setBusy(true);
		setError("");
		try {
			await removeResource(await getApiClient(), resource.id);
			setOpen(false);
			onDeleted();
		} catch (err) {
			setOpen(false);
			setError(
				err instanceof Error && err.message
					? err.message
					: "No se pudo eliminar el recurso",
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<>
			<button
				type="button"
				className="edit-wf-btn edit-delete-btn"
				aria-haspopup="dialog"
				disabled={busy}
				onClick={() => setOpen(true)}
			>
				<span className="material-symbols-outlined" aria-hidden="true">
					delete
				</span>
				Eliminar recurso
			</button>
			{error && (
				<p className="edit-delete-error" role="alert">
					{error}
				</p>
			)}
			{/* Portal: el botón vive dentro del <form> de la edición y el diálogo
			    trae su propio <form>, que no puede ir anidado en el DOM. */}
			{open &&
				createPortal(
					<ConfirmDialog
						open
						title="Eliminar recurso"
						message={deleteResourceMessage(resource.title)}
						confirmLabel="Eliminar recurso"
						busy={busy}
						onCancel={() => setOpen(false)}
						onConfirm={() => void handleConfirm()}
					/>,
					document.body,
				)}
		</>
	);
}
