import { describe, expect, it } from "bun:test";
import { RESOURCE_TYPE_VALUES, RESOURCE_TYPES } from "../resource-types.ts";
import { DEFAULT_LICENSE, VALID_LICENSES } from "../validation.ts";
import {
	buildLegacyArticleDescription,
	isLegacyArticle,
	LEGACY_ARTICLE_RESOURCE_TYPE,
} from "./article.ts";

describe("artículos legacy (issue #446)", () => {
	it("reconoce un artículo por su type POST, sin distinguir mayúsculas ni espacios", () => {
		expect(isLegacyArticle({ type: "POST" })).toBe(true);
		expect(isLegacyArticle({ type: " post " })).toBe(true);
	});

	it("un ODE, un type desconocido o ausente no son artículos", () => {
		expect(isLegacyArticle({ type: "ODE" })).toBe(false);
		expect(isLegacyArticle({ type: "ITINERARIO" })).toBe(false);
		expect(isLegacyArticle({ type: null })).toBe(false);
		expect(isLegacyArticle({})).toBe(false);
	});

	it("la descripción es «Artículo relacionado con» y el título", () => {
		expect(buildLegacyArticleDescription("Homo digitalis")).toBe(
			"Artículo relacionado con Homo digitalis",
		);
	});

	it("el tipo «Artículo» es una entrada normal del diccionario de tipos", () => {
		expect(RESOURCE_TYPE_VALUES).toContain(LEGACY_ARTICLE_RESOURCE_TYPE);
		expect(
			RESOURCE_TYPES.find((type) => type.value === LEGACY_ARTICLE_RESOURCE_TYPE)
				?.label,
		).toBe("Artículo");
	});

	it("la licencia por defecto de la plataforma es una licencia válida", () => {
		expect(VALID_LICENSES).toContain(DEFAULT_LICENSE);
	});
});
