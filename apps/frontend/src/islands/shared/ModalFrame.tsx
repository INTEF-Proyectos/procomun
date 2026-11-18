import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import "./ModalFrame.css";

const FOCUSABLE =
	"button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

interface ModalFrameProps {
	open: boolean;
	titleId: string;
	className: string;
	onClose: () => void;
	children: ReactNode;
}

export function ModalFrame({
	open,
	titleId,
	className,
	onClose,
	children,
}: ModalFrameProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const contentRef = useRef<HTMLDivElement>(null);

	// Foco al primer control del diálogo y, al cerrarlo, de vuelta a quien lo
	// abrió. Va aparte para que un `onClose` nuevo en cada render no lo repita.
	// De layout: la limpieza cierra el <dialog> antes de que React lo quite, y
	// así el fondo ya no es inerte cuando se le devuelve el foco.
	useLayoutEffect(() => {
		if (!open) return;
		const previousFocus =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		// `<dialog>` modal nativo (#580): deja inerte el fondo, así que Tab y
		// Mayús+Tab no salen del diálogo. Después de guardar quién lo abrió:
		// showModal() ya mueve el foco dentro.
		const dialog = dialogRef.current;
		if (dialog && !dialog.open) dialog.showModal();
		if (!contentRef.current?.contains(document.activeElement)) {
			contentRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
		}
		return () => {
			dialog?.close();
			previousFocus?.focus();
		};
	}, [open]);

	useEffect(() => {
		if (!open) return;

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		function handleKeyDown(event: KeyboardEvent) {
			// El fondo es inerte, pero tras el último control el navegador lleva
			// el foco a su propia interfaz: se da la vuelta dentro del diálogo.
			if (event.key === "Tab" && contentRef.current) {
				const focusable =
					contentRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
				const first = focusable[0];
				const last = focusable[focusable.length - 1];
				if (!first || !last) return;
				if (event.shiftKey && document.activeElement === first) {
					event.preventDefault();
					last.focus();
				} else if (!event.shiftKey && document.activeElement === last) {
					event.preventDefault();
					first.focus();
				}
				return;
			}
			if (event.key === "Escape") {
				// Sin el cierre nativo: lo decide quien abre el diálogo (p. ej.
				// no se cierra mientras borra).
				event.preventDefault();
				onClose();
			}
		}

		function handleMouseDown(event: MouseEvent) {
			if (
				contentRef.current &&
				!contentRef.current.contains(event.target as Node)
			) {
				onClose();
			}
		}

		window.addEventListener("keydown", handleKeyDown);
		document.addEventListener("mousedown", handleMouseDown);

		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener("keydown", handleKeyDown);
			document.removeEventListener("mousedown", handleMouseDown);
		};
	}, [open, onClose]);

	if (!open) return null;

	return (
		<dialog
			ref={dialogRef}
			className="admin-modal-overlay"
			aria-labelledby={titleId}
			onCancel={(event) => {
				// Gesto «atrás» u otra petición de cierre: también pasa por onClose.
				event.preventDefault();
				onClose();
			}}
		>
			<div ref={contentRef} className={className}>
				{children}
			</div>
		</dialog>
	);
}
