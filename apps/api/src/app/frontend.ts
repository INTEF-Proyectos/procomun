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
	app.use("/dev", async (c, next) => (isDevelopmentMode() ? next() : c.notFound()));
	app.use("/dev/*", async (c, next) => (isDevelopmentMode() ? next() : c.notFound()));

	app.use(
		"*",
		serveStatic({
			root: frontendDir,
			onNotFound: () => {},
		}),
	);
	app.get("*", serveStatic({ root: frontendDir, path: "/index.html" }));
}
