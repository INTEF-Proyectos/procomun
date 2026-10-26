import * as repo from "@procomun/db/repository";
import { Hono } from "hono";
import type { AuthEnv } from "../../auth/middleware.ts";
import { getCurrentUser } from "../../auth/roles.ts";
import { ensureCurrentUser } from "../../auth/user-sync.ts";
import { getDb } from "../../db.ts";
import { parseJsonBodyOrNull } from "./guards.ts";

/** Alta en el catálogo de palabras clave. Solo curator+ (admin/index.ts). */
const keywordAdminRoutes = new Hono<AuthEnv>();

keywordAdminRoutes.post("/", async (c) => {
	const user = getCurrentUser(c);
	const body = await parseJsonBodyOrNull<{
		label?: unknown;
		aliases?: unknown;
		confirm?: unknown;
	}>(c);
	if (typeof body?.label !== "string") {
		return c.json({ error: "La denominación es obligatoria" }, 400);
	}
	if (body.confirm !== true) {
		return c.json({ error: "Confirma el alta de la palabra clave" }, 400);
	}
	await ensureCurrentUser(user);
	const result = await repo.createCatalogKeyword(getDb().db, {
		label: body.label,
		aliases: Array.isArray(body.aliases)
			? body.aliases.filter(
					(alias): alias is string => typeof alias === "string",
				)
			: [],
		createdBy: user.id,
	});
	if (result.status === "invalid") {
		return c.json({ error: "La denominación es obligatoria" }, 400);
	}
	if (result.status === "duplicate") {
		return c.json(
			{
				error: "Ya existe una palabra clave con esa denominación",
				keyword: result.keyword,
			},
			409,
		);
	}
	return c.json(result.keyword, 201);
});

export { keywordAdminRoutes };
