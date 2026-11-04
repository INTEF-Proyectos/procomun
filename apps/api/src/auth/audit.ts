import { apiAccessLogs } from "@procomun/db/schema";
import type { Context, Next } from "hono";
import { getDb } from "../db.ts";
import { ELPX_PREVIEW_PREFIX } from "../elpx/preview-token.ts";
import type { AuthEnv } from "./middleware.ts";

/**
 * Ruta tal y como se guarda en `api_access_logs` (issue #536).
 *
 * En el enlace firmado de un recurso no publicado (#466) el permiso va en la
 * propia URL: `/api/v1/elpx/preview/<hash>/<token>/…`. Guardar la ruta entera
 * dejaba el token en la tabla, así que quien pudiera leerla podía abrir el
 * contenido no publicado mientras el enlace no caducase (2 h). Se tapa el
 * token y se conserva el hash, que es lo que dice qué recurso se vio. El
 * marcador es el mismo que usa el `access_log` de nginx (#524).
 *
 * `c.req.path` no trae la query, así que el `?token=` de la verificación de
 * correo no llega aquí. La instantánea de la vista previa del editor (#317,
 * `/api/v1/preview/<id>/…` y `/api/v1/preview-session/<id>`) tendrá que añadir
 * su propio marcador `:previewId` cuando esas rutas existan.
 */
const SIGNED_PREVIEW_RE = new RegExp(
	`^(${ELPX_PREVIEW_PREFIX}/[^/]+/)[^/]+(.*)$`,
);

export function redactAuditPath(path: string): string {
	return path.replace(SIGNED_PREVIEW_RE, "$1:token$2");
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
