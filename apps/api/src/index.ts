import { createApp } from "./app.ts";
import { startPreviewSessionSweeper } from "./services/preview-session-store.ts";

const app = createApp();

// Reap idle in-memory preview sessions. The timer is unref'd, so it never keeps
// the process alive on its own.
startPreviewSessionSweeper();

export default {
	port: Number(process.env.PORT ?? 3000),
	fetch: app.fetch,
};

export { app };
