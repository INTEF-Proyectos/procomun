import {
	KNOWLEDGE_AREA_BLOCKS,
	KNOWLEDGE_AREA_MESSAGES,
	PROFESSIONAL_FAMILIES,
} from "@procomun/db/knowledge-areas";
import * as repo from "@procomun/db/repository";
import { Hono } from "hono";
import { logActivity } from "../../activity/log.ts";
import type { AuthEnv } from "../../auth/middleware.ts";
import { getCurrentUser } from "../../auth/roles.ts";
import { ensureCurrentUser } from "../../auth/user-sync.ts";
import { getDb } from "../../db.ts";
import { parseJsonBodyOrNull } from "./guards.ts";

/**
 * Gestión del catálogo de áreas de conocimiento (issue #448, ADR-0045).
 * Solo curator+ (admin/index.ts). Los bloques y las familias profesionales
 * son listas cerradas: aquí solo se leen. Las áreas no se borran: se
 * desactivan y conservan sus asociaciones.
 */
const knowledgeAreaAdminRoutes = new Hono<AuthEnv>();

knowledgeAreaAdminRoutes.get("/", async (c) => {
	const areas = await repo.listKnowledgeAreas(getDb().db, {
		includeInactive: true,
	});
	return c.json({
		blocks: KNOWLEDGE_AREA_BLOCKS,
		areas,
		professionalFamilies: PROFESSIONAL_FAMILIES,
	});
});

knowledgeAreaAdminRoutes.post("/", async (c) => {
	const user = getCurrentUser(c);
	const body = await parseJsonBodyOrNull<Record<string, unknown>>(c);
	if (!body)
		return c.json({ error: KNOWLEDGE_AREA_MESSAGES.labelRequired }, 400);
	await ensureCurrentUser(user);
	const result = await repo.createKnowledgeArea(getDb().db, {
		label: body.label,
		description: body.description,
		blockId: body.blockId,
		createdBy: user.id,
	});
	if (result.status === "invalid")
		return c.json({ error: result.message }, 400);
	if (result.status === "duplicate") {
		return c.json(
			{ error: KNOWLEDGE_AREA_MESSAGES.duplicate, area: result.area },
			409,
		);
	}
	if (result.status !== "created") {
		return c.json({ error: KNOWLEDGE_AREA_MESSAGES.notFound }, 404);
	}
	await logActivity({
		userId: user.id,
		type: "knowledge_area_created",
		description: `Creaste el área de conocimiento «${result.area.label}»`,
		metadata: { areaId: result.area.id },
	});
	return c.json(result.area, 201);
});

knowledgeAreaAdminRoutes.patch("/:id", async (c) => {
	const user = getCurrentUser(c);
	const id = c.req.param("id");
	const body = await parseJsonBodyOrNull<Record<string, unknown>>(c);
	if (!body) return c.json({ error: "Cuerpo de la petición no válido" }, 400);
	const result = await repo.updateKnowledgeArea(getDb().db, id, {
		label: body.label,
		description: body.description,
		blockId: body.blockId,
		active: body.active,
	});
	if (result.status === "not_found") {
		return c.json({ error: KNOWLEDGE_AREA_MESSAGES.notFound }, 404);
	}
	if (result.status === "invalid")
		return c.json({ error: result.message }, 400);
	if (result.status === "duplicate") {
		return c.json(
			{ error: KNOWLEDGE_AREA_MESSAGES.duplicate, area: result.area },
			409,
		);
	}
	await logActivity({
		userId: user.id,
		type: "knowledge_area_updated",
		description: `Actualizaste el área de conocimiento «${result.area.label}»`,
		metadata: { areaId: id, updates: body },
	});
	return c.json(result.area);
});

export { knowledgeAreaAdminRoutes };
