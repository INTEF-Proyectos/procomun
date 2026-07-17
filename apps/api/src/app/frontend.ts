import type { Hono } from "hono";
import { serveStatic } from "hono/bun";
import type { AuthEnv } from "../auth/middleware.ts";
import { isDevelopmentMode } from "../env.ts";

export function registerFrontendServing(
	app: Hono<AuthEnv>,
	frontendDir?: string,
) {
	if (!frontendDir) {
		app.get("/", (c) =>
			c.json({
				name: "Procomun API",
				version: "0.1.0",
			}),
		);
		return;
	}

	// El dashboard de desarrollo y la documentación interna se copian en `dist/dev`
	// dentro del despliegue all-in-one. Sólo deben servirse en modo desarrollo para
	// no exponer información interna (status, decisiones, roles) sin autenticación.
	// Comparación case-insensitive: en FS case-insensitive (p. ej. macOS por defecto)
	// `/Dev/...` serviría el mismo archivo que `/dev/...` si solo bloqueáramos la
	// variante en minúsculas.
	app.use("*", async (c, next) => {
		if (isDevelopmentMode()) return next();
		const pathname = new URL(c.req.url).pathname;
		const normalized = pathname.toLowerCase().replace(/\/{2,}/g, "/");
		if (normalized === "/dev" || normalized.startsWith("/dev/")) {
			return c.notFound();
		}
		return next();
	});

	app.use(
		"*",
		serveStatic({
			root: frontendDir,
			onNotFound: () => {},
		}),
	);
	app.get("*", serveStatic({ root: frontendDir, path: "/index.html" }));
}
