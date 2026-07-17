// Chip.tsx
import type { ReactNode } from "react";
import "./Chip.css";

export interface ChipProps {
	label: string;
	selected?: boolean;
	removable?: boolean;
	icon?: string;
	variant?: "default" | "hero";
	onClick?: () => void;
	onRemove?: () => void;
	className?: string;
}

export function Chip({
	label,
	selected = false,
	removable = false,
	icon,
	variant = "default",
	onClick,
	onRemove,
	className = "",
}: ChipProps) {
	const isInteractive = !!onClick;
	const variantClass = variant === "hero" ? " chip-hero" : "";
	const chipClassName =
		`chip${variantClass}${selected ? " chip-selected" : ""}${isInteractive ? " chip-interactive" : ""} ${className}`.trim();

	const content: ReactNode = (
		<>
			{icon && (
				<span
					className="material-symbols-outlined chip-icon"
					aria-hidden="true"
				>
					{icon}
				</span>
			)}
			<span className="chip-label">{label}</span>
		</>
	);

	const removeButton = removable && onRemove && (
		<button
			className="chip-remove"
			onClick={(e) => {
				e.stopPropagation();
				onRemove();
			}}
			aria-label={`Eliminar ${label}`}
			type="button"
		>
			<span className="material-symbols-outlined" aria-hidden="true">
				close
			</span>
		</button>
	);

	if (isInteractive) {
		return (
			<span className={chipClassName}>
				<button
					type="button"
					className="chip-action"
					aria-pressed={selected}
					onClick={onClick}
				>
					{content}
				</button>
				{removeButton}
			</span>
		);
	}

	return (
		<span className={chipClassName}>
			{content}
			{removeButton}
		</span>
	);
}
