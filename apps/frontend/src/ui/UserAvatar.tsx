import { useState } from "react";

export interface UserAvatarProps {
	/** URL de la foto (hoy, la de Gravatar). Sin ella se muestra la inicial. */
	src: string | null | undefined;
	/** Nombre visible del usuario, del que sale la inicial de respaldo. */
	name: string;
	className?: string;
	fallbackClassName?: string;
}

/**
 * Foto de perfil con la inicial del nombre como respaldo (#514): se usa si no
 * hay URL, porque no pudo calcularse el hash, o si la imagen no carga. La
 * imagen es decorativa: el nombre ya aparece al lado o en la etiqueta del botón.
 */
export function UserAvatar({
	src,
	name,
	className,
	fallbackClassName,
}: UserAvatarProps) {
	const [failedSrc, setFailedSrc] = useState<string | null>(null);

	if (src && src !== failedSrc) {
		return (
			<img
				src={src}
				alt=""
				className={className}
				onError={() => setFailedSrc(src)}
			/>
		);
	}

	return (
		<span className={fallbackClassName} aria-hidden="true">
			{name.trim().charAt(0).toUpperCase() || "?"}
		</span>
	);
}
