import { apiAccessLogs } from "@procomun/db/schema";
import type { Context, Next } from "hono";
import { getDb } from "../db.ts";
import { ELPX_PREVIEW_PREFIX } from "../elpx/preview-token.ts";
import type { AuthEnv } from "./middleware.ts";

/**
 * Ruta tal y como se guarda en `api_access_logs` (issue #536).
 *
 * Varias rutas sin sesión llevan el permiso en la propia URL, y guardar la
 * ruta entera lo dejaba en la tabla: quien pudiera leerla podía reutilizarlo
 * mientras no caducase. Se tapa el secreto y se conserva lo que dice qué se
 * vio. Los marcadores son los mismos que usa el `access_log` de nginx (#524).
 *
 * - Enlace firmado de un recurso no publicado (#466):
 *   `/api/v1/elpx/preview/<hash>/<token>/…`. El token pasa a `:token`.
 * - Miniatura firmada de un recurso no publicado (#512):
 *   `/api/v1/thumbnails/signed/<token>/<fichero>`. El token pasa a `:token`.
 * - Enlace del correo de recuperación de contraseña (#551):
 *   `/api/auth/reset-password/<token>?callbackURL=…`. Better Auth valida el
 *   token y redirige a `/restablecer?token=…`. El token pasa a `:token`.
 * - Instantánea de la vista previa del editor (#317): `/api/v1/preview/<id>/…`
 *   y `/api/v1/preview-session/<id>/…`. El UUID pasa a `:previewId`.
 *
 * Se tapa cualquier segmento en la posición del token, válido o no, porque la
 * auditoría no sabe si se verificó. Sin distinguir mayúsculas, como #317.
 * `c.req.path` llega ya decodificado (Hono), así que `previe%77` no se cuela,
 * y no trae la query, así que el `?token=` de la verificación de correo
 * tampoco llega aquí.
 */
const CAPABILITY_PATHS: ReadonlyArray<readonly [RegExp, string]> = [
	[new RegExp(`^(${ELPX_PREVIEW_PREFIX}/[^/]+/)[^/]+`, "i"), "$1:token"],
	[/^(\/api\/v1\/thumbnails\/signed\/)[^/]+/i, "$1:token"],
	[/^(\/api\/auth\/reset-password\/)[^/]+/i, "$1:token"],
	[
		/^(\/api\/v1\/preview(?:-session)?\/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
		"$1:previewId",
	],
];

export function redactAuditPath(path: string): string {
	return CAPABILITY_PATHS.reduce(
		(acc, [re, marker]) => acc.replace(re, marker),
		path,
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
