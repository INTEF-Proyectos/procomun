import { canTransition } from "@procomun/db/validation";

/** Botón de cambio de estado editorial en la edición de un recurso. */
export interface EditorialAction {
	to: string;
	label: string;
	icon: string;
	cssClass: string;
}

// Solo la presentación: quién puede hacer cada transición lo decide
// canTransition, la misma regla que aplica la API (#506).
const EDITORIAL_ACTIONS: Record<string, EditorialAction[]> = {
	draft: [
		{
			to: "review",
			label: "Enviar a revisión",
			icon: "rate_review",
			cssClass: "edit-wf-btn-gold",
		},
		{
			to: "published",
			label: "Publicar directamente",
			icon: "check_circle",
			cssClass: "edit-wf-btn-green",
		},
	],
	review: [
		{
			to: "draft",
			label: "Devolver a borrador",
			icon: "undo",
			cssClass: "edit-wf-btn-outline",
		},
		{
			to: "published",
			label: "Publicar",
			icon: "check_circle",
			cssClass: "edit-wf-btn-green",
		},
	],
	published: [
		{
			to: "archived",
			label: "Archivar",
			icon: "archive",
			cssClass: "edit-wf-btn-outline",
		},
	],
	archived: [
		{
			to: "draft",
			label: "Restaurar a borrador",
			icon: "restore",
			cssClass: "edit-wf-btn-outline",
		},
	],
};

/** Acciones que `role` puede hacer sobre un recurso en `status`. */
export function editorialActionsFor(
	status: string,
	role: string,
): EditorialAction[] {
	return (EDITORIAL_ACTIONS[status] ?? []).filter((action) =>
		canTransition(status, action.to, role),
	);
}

interface EditorialActionsProps {
	status: string;
	role: string;
	onTransition: (to: string) => void;
}

export function EditorialActions({
	status,
	role,
	onTransition,
}: EditorialActionsProps) {
	const actions = editorialActionsFor(status, role);
	if (actions.length === 0) return null;
	return (
		<div className="edit-wf-actions">
			{actions.map((action) => (
				<button
					key={action.to}
					type="button"
					className={`edit-wf-btn ${action.cssClass}`}
					onClick={() => onTransition(action.to)}
				>
					<span className="material-symbols-outlined">{action.icon}</span>
					{action.label}
				</button>
			))}
		</div>
	);
}
