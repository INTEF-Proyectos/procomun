import {
	KNOWLEDGE_AREA_BLOCKS,
	PROFESSIONAL_FAMILIES,
} from "@procomun/db/knowledge-areas";
import * as repo from "@procomun/db/repository";
import { Hono } from "hono";
import { getDb } from "../db.ts";

/**
 * Catálogo público de áreas de conocimiento y familias profesionales (#448,
 * ADR-0045) para los formularios y los filtros del buscador. Incluye las
 * áreas desactivadas, marcadas con `active: false`: el formulario no las
 * ofrece, pero el buscador sigue encontrando los recursos que las tienen.
 * La gestión (alta, edición, recuentos) va en /api/admin/knowledge-areas.
 */
const knowledgeAreaRoutes = new Hono();

knowledgeAreaRoutes.get("/", async (c) => {
	const areas = await repo.listKnowledgeAreas(getDb().db, {
		includeInactive: true,
	});
	return c.json({
		blocks: KNOWLEDGE_AREA_BLOCKS,
		areas: areas.map(({ id, label, blockId, active }) => ({
			id,
			label,
			blockId,
			active,
		})),
		professionalFamilies: PROFESSIONAL_FAMILIES,
	});
});

export { knowledgeAreaRoutes };
