/**
 * Marcador de una tarjeta sin imagen ni paquete (#409): el icono del tipo de
 * recurso o, si no tiene, el genérico. Es decorativo (`aria-hidden`) para no
 * añadir texto al nombre del enlace de la tarjeta.
 */
export function CardTypeMarker({
	icon,
	className = "",
	style,
}: {
	icon: string | null;
	className?: string;
	style?: React.CSSProperties;
}) {
	if (icon) {
		return (
			<span
				className={`card-type-marker ${className}`.trim()}
				style={style}
				aria-hidden="true"
			>
				{icon}
			</span>
		);
	}
	return (
		<span
			className={`card-type-marker material-symbols-outlined ${className}`.trim()}
			style={style}
			aria-hidden="true"
		>
			description
		</span>
	);
}
