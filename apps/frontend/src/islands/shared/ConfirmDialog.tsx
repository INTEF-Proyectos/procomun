import { ModalFrame } from "./ModalFrame.tsx";
import "./ConfirmDialog.css";

interface ConfirmDialogProps {
	open: boolean;
	title: string;
	message: string;
	confirmLabel: string;
	cancelLabel?: string;
	/** Texto del botón mientras se confirma (por defecto, «Eliminando...»). */
	busyLabel?: string;
	busy?: boolean;
	onCancel: () => void;
	onConfirm: () => void;
}

export function ConfirmDialog({
	open,
	title,
	message,
	confirmLabel,
	cancelLabel = "Cancelar",
	busyLabel = "Eliminando...",
	busy = false,
	onCancel,
	onConfirm,
}: ConfirmDialogProps) {
	if (!open) return null;

	return (
		<ModalFrame
			open={open}
			className="admin-confirm-dialog"
			titleId="confirm-dialog-title"
			onClose={onCancel}
		>
			<form
				method="dialog"
				onSubmit={(event) => {
					event.preventDefault();
					// Puede colgar de otro <form> (edición del recurso): que el submit no
					// burbujee hasta él.
					event.stopPropagation();
					onConfirm();
				}}
			>
				<h2 id="confirm-dialog-title" className="sr-only">
					{title}
				</h2>
				<p>{message}</p>
				<div className="admin-dialog-actions">
					<button
						type="button"
						className="admin-btn"
						onClick={onCancel}
						disabled={busy}
					>
						{cancelLabel}
					</button>
					<button
						type="submit"
						className="admin-btn admin-btn--danger"
						disabled={busy}
					>
						{busy ? busyLabel : confirmLabel}
					</button>
				</div>
			</form>
		</ModalFrame>
	);
}
