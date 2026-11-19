import { useEffect, useState } from "react";
import { getApiClient } from "../lib/get-api-client.ts";
import { loadMediaBankUrl } from "../lib/media-bank.ts";
import * as m from "../paraglide/messages.js";

interface MediaBankLinkViewProps {
	href: string | null;
	className?: string;
	label?: string;
}

/**
 * Enlace normal al banco multimedia (#569): misma pestaña, texto visible y
 * traducido. Sin URL no pinta nada.
 */
export function MediaBankLinkView({
	href,
	className,
	label,
}: MediaBankLinkViewProps) {
	if (!href) return null;
	return (
		<a href={href} className={className}>
			{label ?? m.nav_media_bank()}
		</a>
	);
}

/** URL del banco multimedia desde `/api/v1/config`; `null` mientras carga o si falta. */
export function useMediaBankUrl(): string | null {
	const [href, setHref] = useState<string | null>(null);
	useEffect(() => {
		let active = true;
		loadMediaBankUrl(async () => (await getApiClient()).getConfig()).then(
			(value) => {
				if (active) setHref(value);
			},
		);
		return () => {
			active = false;
		};
	}, []);
	return href;
}

export function MediaBankLink(props: Omit<MediaBankLinkViewProps, "href">) {
	return <MediaBankLinkView href={useMediaBankUrl()} {...props} />;
}
