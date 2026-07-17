import * as repo from "@procomun/db/repository";
import type { Context, Next } from "hono";
import { getDb } from "../db.ts";
import type { AuthEnv } from "./middleware.ts";

/**
 * Simple in-memory rate limiter per token.
 * Allows `maxRequests` per `windowMs` milliseconds.
 */
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

function checkRateLimit(tokenId: string): {
	allowed: boolean;
	remaining: number;
	resetAt: number;
} {
	const now = Date.now();
	let entry = rateLimitStore.get(tokenId);

	if (!entry || now >= entry.resetAt) {
		entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
		rateLimitStore.set(tokenId, entry);
	}

	entry.count++;
	const allowed = entry.count <= RATE_LIMIT_MAX;
	return {
		allowed,
		remaining: Math.max(0, RATE_LIMIT_MAX - entry.count),
		resetAt: entry.resetAt,
	};
}

/**
 * Middleware that authenticates requests using Bearer tokens.
 * Sets user and session in context if valid token is found.
 */
export async function tokenAuthMiddleware(c: Context<AuthEnv>, next: Next) {
	const authHeader = c.req.header("Authorization");
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return c.json(
			{
				error:
					"Token de autenticación requerido. Usa la cabecera Authorization: Bearer <token>",
			},
			401,
		);
	}

	const rawToken = authHeader.slice(7);
	if (!rawToken || rawToken.length < 10) {
		return c.json({ error: "Token inválido" }, 401);
	}

	const db = getDb().db;
	const result = await repo.validateApiToken(db, rawToken);

	if (!result) {
		return c.json({ error: "Token inválido o expirado" }, 401);
	}

	// Rate limiting por usuario (no por token): de lo contrario un usuario podría
	// rotar/crear múltiples tokens para multiplicar su cuota y eludir el límite.
	const rateLimit = checkRateLimit(result.userId);
	c.header("X-RateLimit-Limit", String(RATE_LIMIT_MAX));
	c.header("X-RateLimit-Remaining", String(rateLimit.remaining));
	c.header("X-RateLimit-Reset", String(Math.ceil(rateLimit.resetAt / 1000)));

	if (!rateLimit.allowed) {
		return c.json(
			{ error: "Demasiadas peticiones. Inténtalo de nuevo más tarde." },
			429,
		);
	}

	// Load the user
	const user = await repo.getUserById(db, result.userId);
	if (!user || !user.isActive) {
		return c.json({ error: "Usuario no activo" }, 403);
	}

	// Set user in context (same shape as session-based auth).
	// getUserById returns the app user model; better-auth Session.user is wider.
	c.set("user", user as unknown as AuthEnv["Variables"]["user"]);
	c.set("session", null);

	await next();
}
