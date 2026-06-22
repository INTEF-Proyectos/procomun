import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { requireAuth } from "../auth/middleware.ts";
import { getCurrentUser } from "../auth/roles.ts";
import { ensureCurrentUser } from "../auth/user-sync.ts";
import { getDb } from "../db.ts";
import * as repo from "@procomun/db/repository";

const apiTokenRoutes = new Hono<AuthEnv>();

// Token management requires auth (applied via session middleware at registration)
apiTokenRoutes.use("*", requireAuth);

// POST /api/v1/tokens — Create a new API token
apiTokenRoutes.post("/", async (c) => {
	const user = getCurrentUser(c);
	const db = getDb().db;
	await ensureCurrentUser(user);

	let body: { name?: string; expiresAt?: string };
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: "El cuerpo debe ser JSON válido" }, 400);
	}

	if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
		return c.json({ error: "El nombre del token es obligatorio" }, 400);
	}

	if (body.name.length > 255) {
		return c.json({ error: "El nombre no puede superar 255 caracteres" }, 400);
	}

	let expiresAt: Date | undefined;
	if (body.expiresAt) {
		expiresAt = new Date(body.expiresAt);
		if (Number.isNaN(expiresAt.getTime())) {
			return c.json({ error: "Fecha de expiración no válida" }, 400);
		}
		if (expiresAt <= new Date()) {
			return c.json({ error: "La fecha de expiración debe ser futura" }, 400);
		}
	}

	const result = await repo.createApiToken(db, {
		userId: user.id,
		name: body.name.trim(),
		expiresAt,
	});

	// The raw token is only shown once
	return c.json(
		{
			id: result.id,
			name: result.name,
			token: result.rawToken,
			tokenPrefix: result.tokenPrefix,
			createdAt: result.createdAt,
			message: "Guarda este token de forma segura. No se mostrará de nuevo.",
		},
		201,
	);
});

// GET /api/v1/tokens — List user's tokens
apiTokenRoutes.get("/", async (c) => {
	const user = getCurrentUser(c);
	const db = getDb().db;
	const tokens = await repo.listApiTokens(db, user.id);
	return c.json({ data: tokens });
});

// DELETE /api/v1/tokens/:id — Revoke a token
apiTokenRoutes.delete("/:id", async (c) => {
	const user = getCurrentUser(c);
	const { id } = c.req.param();
	const db = getDb().db;

	await repo.revokeApiToken(db, id, user.id);
	return c.json({ id, revoked: true });
});

export { apiTokenRoutes };
