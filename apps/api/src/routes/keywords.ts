import * as repo from "@procomun/db/repository";
import { Hono } from "hono";
import { getDb } from "../db.ts";

/**
 * Búsqueda pública del catálogo de palabras clave (issue #384). Un alias
 * devuelve el término al que apunta, nunca el alias como término propio.
 * `tags=1` (filtro del buscador) añade las etiquetas libres anteriores para
 * que el fondo sin catálogo siga siendo filtrable.
 */
const keywordRoutes = new Hono();

keywordRoutes.get("/", async (c) => {
	const db = getDb().db;
	const q = c.req.query("q") ?? "";
	const data = await repo.searchCatalogKeywords(db, q);
	if (c.req.query("tags") === "1" && q.trim()) {
		for (const tag of await repo.suggestTags(db, q, 10)) {
			if (tag.catalog) continue;
			data.push({ id: tag.id, slug: tag.slug, label: tag.label, match: "tag" });
		}
	}
	return c.json({ data });
});

export { keywordRoutes };
