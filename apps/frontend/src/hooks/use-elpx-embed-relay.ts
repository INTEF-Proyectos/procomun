import { type RefObject, useEffect, useState } from "react";
import {
	classifyEmbed,
	type EmbedClassification,
} from "../lib/elpx-embed-policy.ts";

/**
 * Relay del frame principal para los embeds promocionados desde el iframe de
 * preview del .elpx (ADR-0027). Recibe el `postMessage` que envía el shim
 * (apps/api/static/elpx/embed-shim.js), lo valida y expone el embed a abrir en
 * un player de confianza (EmbedModal).
 */

export type EmbedMessage = {
	source?: string;
	action?: string;
	url?: string;
};

export type ResolveEmbedContext = {
	/** contentWindow del iframe de preview de confianza. */
	trustedSource: Window | null;
	/** Origen del frame principal (window.location.origin). */
	pageOrigin: string;
	/** URL base del contenido servido (src del iframe de preview). */
	contentBaseUrl?: string;
};

/**
 * Función pura: valida un mensaje del shim y devuelve el embed a abrir, o null.
 * Autentica por IDENTIDAD DE VENTANA (en origen opaco `event.origin` es "null"
 * y no es fiable), y delega la decisión de seguridad en `classifyEmbed`.
 */
export function resolveEmbedMessage(
	event: Pick<MessageEvent, "source" | "data">,
	ctx: ResolveEmbedContext,
): EmbedClassification | null {
	if (!ctx.trustedSource || event.source !== ctx.trustedSource) return null;

	const data = event.data as EmbedMessage | null;
	if (
		data?.source !== "procomun-elpx-embed" ||
		data.action !== "play" ||
		typeof data.url !== "string"
	) {
		return null;
	}

	return classifyEmbed(data.url, {
		pageOrigin: ctx.pageOrigin,
		contentBaseUrl: ctx.contentBaseUrl,
	});
}

/**
 * Crea el manejador de `message` (lógica pura, testeable sin DOM): resuelve el
 * mensaje y, si es un embed válido, lo entrega a `onEmbed`.
 */
export function createEmbedMessageHandler(
	getContext: () => ResolveEmbedContext,
	onEmbed: (embed: EmbedClassification) => void,
): (event: MessageEvent) => void {
	return (event: MessageEvent) => {
		const resolved = resolveEmbedMessage(event, getContext());
		if (resolved) onEmbed(resolved);
	};
}

export function useElpxEmbedRelay(
	iframeRef: RefObject<HTMLIFrameElement | null>,
	contentBaseUrl?: string,
): { activeEmbed: EmbedClassification | null; close: () => void } {
	const [activeEmbed, setActiveEmbed] = useState<EmbedClassification | null>(
		null,
	);

	useEffect(() => {
		const handler = createEmbedMessageHandler(
			() => ({
				trustedSource: iframeRef.current?.contentWindow ?? null,
				pageOrigin: window.location.origin,
				contentBaseUrl,
			}),
			setActiveEmbed,
		);
		window.addEventListener("message", handler);
		return () => window.removeEventListener("message", handler);
	}, [iframeRef, contentBaseUrl]);

	return { activeEmbed, close: () => setActiveEmbed(null) };
}
