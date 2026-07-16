import { type ReactNode, useEffect, useRef } from "react";
import "./Drawer.css";

export interface DrawerProps {
	open: boolean;
	onClose: () => void;
	title: string;
	children: ReactNode;
	position?: "left" | "right";
	className?: string;
}

export function Drawer({
	open,
	onClose,
	title,
	children,
	position = "left",
	className = "",
}: DrawerProps) {
	const drawerRef = useRef<HTMLDivElement>(null);
	const previousFocusRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (!open) return;

		previousFocusRef.current = document.activeElement as HTMLElement;
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		const firstFocusable = drawerRef.current?.querySelector<HTMLElement>(
			'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
		);
		firstFocusable?.focus();

		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === "Escape") {
				onClose();
				return;
			}

			if (e.key === "Tab" && drawerRef.current) {
				const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
					'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
				);
				if (focusable.length === 0) return;
				const first = focusable[0];
				const last = focusable[focusable.length - 1];

				if (e.shiftKey && document.activeElement === first) {
					e.preventDefault();
					last.focus();
				} else if (!e.shiftKey && document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}
		}

		function handleMouseDown(e: MouseEvent) {
			if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
				onClose();
			}
		}

		window.addEventListener("keydown", handleKeyDown);
		document.addEventListener("mousedown", handleMouseDown);

		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener("keydown", handleKeyDown);
			document.removeEventListener("mousedown", handleMouseDown);
			previousFocusRef.current?.focus();
		};
	}, [open, onClose]);

	if (!open) return null;

	return (
		<div className="drawer-overlay">
			<div
				ref={drawerRef}
				className={`drawer drawer-${position} ${className}`.trim()}
				role="dialog"
				aria-modal="true"
				aria-label={title}
			>
				<div className="drawer-header">
					<h2 className="drawer-title">{title}</h2>
					<button
						className="drawer-close"
						onClick={onClose}
						aria-label="Cerrar"
						type="button"
					>
						<span className="material-symbols-outlined" aria-hidden="true">
							close
						</span>
					</button>
				</div>
				<div className="drawer-body">{children}</div>
			</div>
		</div>
	);
}
