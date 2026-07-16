import { useId, useState } from "react";
import "./StarRating.css";

export interface StarRatingProps {
	value?: number;
	max?: number;
	readOnly?: boolean;
	onChange?: (score: number) => void;
	size?: "sm" | "md" | "lg";
	className?: string;
}

function starClassName(filled: boolean, halfFilled: boolean) {
	return `star-rating-star${filled ? " star-filled" : ""}${halfFilled ? " star-half" : ""}`;
}

function starIcon(filled: boolean, halfFilled: boolean) {
	return (
		<span className="material-symbols-outlined" aria-hidden="true">
			{filled ? "star" : halfFilled ? "star_half" : "star"}
		</span>
	);
}

export function StarRating({
	value = 0,
	max = 5,
	readOnly = false,
	onChange,
	size = "md",
	className = "",
}: StarRatingProps) {
	const [hovered, setHovered] = useState(0);
	const groupName = useId();
	const displayValue = hovered || value;

	if (readOnly) {
		return (
			<div
				className={`star-rating star-rating-${size} star-rating-readonly ${className}`.trim()}
				role="img"
				aria-label={`Valoración: ${value} de ${max}`}
			>
				{Array.from({ length: max }, (_, i) => {
					const star = i + 1;
					const filled = star <= displayValue;
					const halfFilled = !filled && star - 0.5 <= displayValue;
					return (
						<span key={star} className={starClassName(filled, halfFilled)}>
							{starIcon(filled, halfFilled)}
						</span>
					);
				})}
			</div>
		);
	}

	return (
		<div
			className={`star-rating star-rating-${size} ${className}`.trim()}
			role="radiogroup"
			aria-label="Selecciona una valoración"
		>
			{Array.from({ length: max }, (_, i) => {
				const star = i + 1;
				const filled = star <= displayValue;
				const halfFilled = !filled && star - 0.5 <= displayValue;
				return (
					<label
						key={star}
						className={starClassName(filled, halfFilled)}
						onMouseEnter={() => setHovered(star)}
						onMouseLeave={() => setHovered(0)}
					>
						<input
							type="radio"
							className="star-rating-input"
							name={groupName}
							checked={star === value}
							onChange={() => onChange?.(star)}
							aria-label={`${star} estrella${star !== 1 ? "s" : ""}`}
						/>
						{starIcon(filled, halfFilled)}
					</label>
				);
			})}
		</div>
	);
}
