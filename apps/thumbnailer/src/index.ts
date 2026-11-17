/**
 * Servicio `thumbnailer` (#470, ADR-0046): genera la miniatura de la portada
 * de un paquete `.elpx` extraído. Corre en su propio contenedor, sin red de
 * salida, sin secretos y con el almacenamiento en solo lectura.
 *
 *   bun run apps/thumbnailer/src/index.ts
 */
import path from "node:path";
import { chromiumLauncher, type Launcher } from "./browser.ts";
import { BrowserPool } from "./browser-pool.ts";
import { captureThumbnail } from "./capture.ts";
import {
	getThumbnailerServiceConfig,
	type ThumbnailerServiceConfig,
} from "./config.ts";
import { createThumbnailerHandler, Limiter } from "./server.ts";

type Logger = Pick<typeof console, "info" | "warn">;

export function createRenderer(
	config: ThumbnailerServiceConfig,
	pool: BrowserPool,
) {
	return async (hash: string) => {
		const outcome = await pool.run((browser) =>
			captureThumbnail(browser, path.join(config.storageDir, "elpx", hash), {
				timeoutMs: config.timeoutMs,
				settleMs: config.settleMs,
				maxImageBytes: config.maxImageBytes,
				maxAssetBytes: config.maxAssetBytes,
			}),
		);
		return outcome.result;
	};
}

export function startThumbnailer(
	config: ThumbnailerServiceConfig,
	deps: { launch?: Launcher; log?: Logger } = {},
) {
	const log = deps.log ?? console;
	const pool = new BrowserPool(deps.launch ?? chromiumLauncher(config), {
		recycleAfter: config.recycleAfter,
	});
	const handler = createThumbnailerHandler({
		render: createRenderer(config, pool),
		limiter: new Limiter(config.concurrency, config.queueLimit),
		browserError: () => pool.lastLaunchError,
		log,
	});
	const server = Bun.serve({
		hostname: config.host,
		port: config.port,
		fetch: handler,
	});
	log.info(
		`[thumbnailer] escuchando en ${config.host}:${server.port} (concurrencia ${config.concurrency}, sandbox ${config.chromiumSandbox ? "sí" : "no"})`,
	);
	// Se arranca Chromium ya: si no puede, /health lo dice desde el principio.
	const ready = pool.warmUp().catch((err: unknown) => {
		log.warn(
			`[thumbnailer] Chromium no arranca: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}. Revisa el perfil seccomp y THUMBNAILER_CHROMIUM_SANDBOX (docs/operaciones/operaciones.md).`,
		);
	});
	return {
		ready,
		server,
		pool,
		async stop() {
			server.stop(true);
			await pool.close();
		},
	};
}

if (import.meta.main) {
	const service = startThumbnailer(getThumbnailerServiceConfig());
	for (const signal of ["SIGTERM", "SIGINT"] as const) {
		process.on(signal, () => {
			service.stop().finally(() => process.exit(0));
		});
	}
}
