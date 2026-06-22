import { Dialog } from "../../ui/Dialog.tsx";
import type { EmbedClassification } from "../../lib/elpx-embed-policy.ts";

/**
 * Player de confianza para los embeds promocionados desde el .elpx (ADR-0027).
 *
 * Lo crea Procomún en el frame principal, por lo que el iframe del proveedor se
 * carga con SU propio origen (p.ej. youtube.com), aislado de Procomún por la
 * Same-Origin Policy. El contenido del autor sigue en origen opaco; nunca llega
 * aquí una URL same-origin de tipo vídeo (lo garantiza `classifyEmbed`).
 */
export function EmbedModal({
	embed,
	onClose,
}: {
	embed: EmbedClassification | null;
	onClose: () => void;
}) {
	if (!embed) return null;

	const isVideo = embed.kind === "video";

	return (
		<Dialog
			open={true}
			onClose={onClose}
			title={isVideo ? "Vídeo" : "Documento PDF"}
			size="lg"
			className="embed-modal"
		>
			<div
				style={{
					position: "relative",
					width: "100%",
					...(isVideo
						? { aspectRatio: "16 / 9" }
						: { height: "70vh" }),
				}}
			>
				{isVideo ? (
					<iframe
						src={embed.url}
						title="Reproductor de vídeo"
						sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
						allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
						referrerPolicy="strict-origin-when-cross-origin"
						allowFullScreen
						style={{ width: "100%", height: "100%", border: 0 }}
					/>
				) : (
					<iframe
						src={embed.url}
						title="Documento PDF"
						allow="fullscreen"
						referrerPolicy="no-referrer"
						style={{ width: "100%", height: "100%", border: 0 }}
					/>
				)}
			</div>
		</Dialog>
	);
}
