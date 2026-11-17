import type { ResourceTypeValue } from "../resource-types.ts";
import type { LegacyOdeJson } from "./types.ts";

/**
 * Artículos del Procomún antiguo (#446). Llegan como cualquier ODE, en pares
 * `.json` + `.elpx`, pero con `type: "POST"`, sin licencia y con el cuerpo del
 * artículo en HTML en `descriptionStr`. El `.elpx` ya trae el artículo
 * completo; su licencia (CC BY-SA 4.0 en todos) la pone el exportador.
 */
const LEGACY_ARTICLE_TYPE = "POST";

/**
 * Tipo de recurso de todo artículo importado. Es una entrada normal de
 * RESOURCE_TYPES: si el diccionario cambia, el tipado obliga a revisar esto.
 */
export const LEGACY_ARTICLE_RESOURCE_TYPE: ResourceTypeValue = "articulo";

export function isLegacyArticle(json: Pick<LegacyOdeJson, "type">): boolean {
	return (
		typeof json.type === "string" &&
		json.type.trim().toUpperCase() === LEGACY_ARTICLE_TYPE
	);
}

/** Los artículos no tienen descripción propia: se usa un texto fijo (#446). */
export function buildLegacyArticleDescription(title: string): string {
	return `Artículo relacionado con ${title}`;
}
