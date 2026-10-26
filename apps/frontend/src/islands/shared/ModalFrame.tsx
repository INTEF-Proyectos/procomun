import { type ReactNode, useEffect, useRef } from "react";
import "./ModalFrame.css";

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
	const contentRef = useRef<HTMLDivElement>(null);

	// Foco al primer control del diálogo y, al cerrarlo, de vuelta a quien lo
	// abrió. Va aparte para que un `onClose` nuevo en cada render no lo repita.
	useEffect(() => {
		if (!open) return;
		const previousFocus =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		if (!contentRef.current?.contains(document.activeElement)) {
			contentRef.current
				?.querySelector<HTMLElement>(
					"button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
				)
				?.focus();
		}
		return () => previousFocus?.focus();
	}, [open]);

	useEffect(() => {
		if (!open) return;

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		function handleEscape(event: KeyboardEvent) {
			if (event.key === "Escape") {
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

		window.addEventListener("keydown", handleEscape);
		document.addEventListener("mousedown", handleMouseDown);

		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener("keydown", handleEscape);
			document.removeEventListener("mousedown", handleMouseDown);
		};
	}, [open, onClose]);

	if (!open) return null;

	return (
		<div className="admin-modal-overlay">
			<div
				ref={contentRef}
				className={className}
				role="dialog"
				aria-modal="true"
				aria-labelledby={titleId}
			>
				{children}
			</div>
		</div>
	);
}
