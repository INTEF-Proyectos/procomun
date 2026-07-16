import { type ReactNode, useEffect, useRef } from "react";

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
