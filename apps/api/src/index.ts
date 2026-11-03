import { createApp } from "./app.ts";
import { startThumbnailWorkerFromEnv } from "./thumbnails/start.ts";

const app = createApp();

// #470: miniaturas generadas en el servidor. Sin THUMBNAILER_URL (y siempre
// con NODE_ENV=test) no arranca nada.
startThumbnailWorkerFromEnv();

export default {
	port: Number(process.env.PORT ?? 3000),
	fetch: app.fetch,
};

export { app };
