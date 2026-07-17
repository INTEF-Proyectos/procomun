import { apiAccessLogs } from "@procomun/db/schema";
import type { Context, Next } from "hono";
import { getDb } from "../db.ts";
import type { AuthEnv } from "./middleware.ts";

/**
 * Redact the preview-session capability id from an audit path before it is
 * persisted to the durable `api_access_logs` table.
 *
 * The preview SERVING route (`/api/v1/preview/{previewId}/*`) is an AUTHLESS
 * capability URL whose `previewId` UUID is the ONLY secret — anyone holding it
 * can read the live preview. The management route (`/api/v1/preview-session/...`)
 * carries the same id. Writing that id verbatim into a durable audit log would
 * leak a live capability to anyone who can read the logs, so replace the UUID
 * segment with `:previewId`; the access is still audited (method, route, user,
 * status), just without the secret.
 */
export function redactAuditPath(path: string): string {
	return path.replace(
		/^(\/api\/v1\/preview(?:-session)?)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
		"$1/:previewId",
	);
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
		c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
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
