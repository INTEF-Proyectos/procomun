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
	//
	// La guarda debe comparar exactamente la misma ruta que resuelve `serveStatic`:
	// - `c.req.path` es la ruta que consume `serveStatic`, ya decodificada por Hono
	//   con `decodeURI`, así que hay que partir de ella y no de `new URL(...).pathname`
	//   (si no, `/%64ev/data/status.yaml` esquiva la guarda y sirve el fichero).
	// - `decodeURI` no decodifica caracteres reservados, por lo que decodificamos
	//   además los restantes (`%2f`, `%2F`, ...) antes de comparar.
	// - Comparación case-insensitive: en FS case-insensitive (p. ej. macOS por
	//   defecto) `/Dev/...` serviría el mismo archivo que `/dev/...`.
	// Si la ruta no se puede decodificar, se responde 404 (fallo cerrado): Hono
	// aplica una decodificación parcial tolerante y podría acabar resolviendo el
	// fichero igualmente.
	//
	// Los bytes nulos (`%00`) también se rechazan aquí: además de ser un vector
	// clásico de truncado de rutas, `serveStatic` de Bun lanza al pasarlos a
	// `Bun.file()` y la petición acaba en un 500 sin manejar.
	app.use("*", async (c, next) => {
		let pathname: string;
		try {
			pathname = decodeURIComponent(c.req.path);
		} catch {
			return c.notFound();
		}
		if (pathname.includes("\0")) {
			return c.notFound();
		}
		if (isDevelopmentMode()) return next();
		const normalized = pathname
			.toLowerCase()
			.replace(/\\/g, "/")
			.replace(/\/{2,}/g, "/");
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
