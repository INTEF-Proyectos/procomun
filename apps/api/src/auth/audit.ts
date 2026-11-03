import { apiAccessLogs } from "@procomun/db/schema";
import type { Context, Next } from "hono";
import { getDb } from "../db.ts";
import type { AuthEnv } from "./middleware.ts";

/**
 * Redact capability secrets from an audit path before it is persisted to the
 * durable `api_access_logs` table. Two AUTHLESS routes carry their only secret
 * in the path; anyone holding the logged path could replay it:
 *
 * - Editor preview (#317): `/api/v1/preview/{previewId}/*` serves the live
 *   snapshot, and the management route `/api/v1/preview-session/{previewId}`
 *   carries the same id. The UUID becomes `:previewId`.
 * - Signed `.elpx` preview of an unpublished resource (#466):
 *   `/api/v1/elpx/preview/{hash}/{token}/*`. The HMAC token becomes `:token`.
 *   The hash only names the package (the stable URL refuses unpublished
 *   ones), so it is kept: it says which resource was previewed. Any segment
 *   in the token position is redacted, valid or not, because the audit does
 *   not know whether it verified.
 *
 * The access is still audited (method, route, user, status), just without the
 * secret. The query string is not part of `c.req.path`, so it never gets here.
 */
export function redactAuditPath(path: string): string {
	return path
		.replace(
			/^(\/api\/v1\/preview(?:-session)?)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
			"$1/:previewId",
		)
		.replace(/^(\/api\/v1\/elpx\/preview\/[^/]+)\/[^/]+/i, "$1/:token");
}

/**
 * Middleware de auditoría para el cumplimiento del ENS.
 * Registra todos los accesos a la API en la tabla api_access_logs.
 */
export async function auditMiddleware(c: Context<AuthEnv>, next: Next) {
	const start = Date.now();

	await next();

	const latencyMs = Date.now() - start;
	const user = c.get("user");
	const method = c.req.method;
	const path = redactAuditPath(c.req.path);
	const status = c.res.status;
	const ipAddress =
		c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
		c.req.header("cf-connecting-ip") ||
		c.req.header("x-real-ip") ||
		null;
	const userAgent = c.req.header("user-agent");

	// Fire-and-forget logging to not block the response
	const db = getDb().db;
	db.insert(apiAccessLogs)
		.values({
			id: crypto.randomUUID(),
			userId: user?.id ?? null,
			method,
			path,
			status,
			ipAddress,
			userAgent,
			latencyMs,
			createdAt: new Date(),
		})
		.catch(() => {
			// Never let audit logging failure break the API response
		});
}
