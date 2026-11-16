import { authorProfileHref, splitAuthorNames } from "../lib/author-links.ts";
import { searchHref } from "../lib/resource-display.ts";
import "../lib/paraglide-client.ts";
import * as m from "../paraglide/messages.js";
import "./AuthorLinks.css";

/** Nombre de la cuenta que publica: enlace a su ficha pública (#458). */
export function PublisherLink({ id, name }: { id: string; name: string }) {
	return (
		<a className="author-link" href={authorProfileHref(id)}>
			{name}
		</a>
	);
}

/** Autores del texto libre: cada nombre lanza una búsqueda con él (#458). */
export function AuthorSearchLinks({
	author,
}: {
	author: string | null | undefined;
}) {
	return splitAuthorNames(author).map((name, index) => (
		<span key={name}>
			{index > 0 ? ", " : null}
			<a className="author-link" href={searchHref(name)}>
				{name}
			</a>
		</span>
	));
}

export type BylineResource = {
	createdBy?: string | null;
	createdByName?: string | null;
	author?: string | null;
};

/**
 * Autoría breve para tarjetas: la cuenta que publica si la hay; si no (recursos
 * importados sin cuenta), los autores del texto libre; si tampoco, «Anónimo».
 */
export function ResourceByline({ resource }: { resource: BylineResource }) {
	if (resource.createdBy && resource.createdByName) {
		return (
			<PublisherLink id={resource.createdBy} name={resource.createdByName} />
		);
	}
	if (splitAuthorNames(resource.author).length > 0) {
		return <AuthorSearchLinks author={resource.author} />;
	}
	return <>{m.common_anonymous()}</>;
}
