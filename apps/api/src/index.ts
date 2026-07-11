import { createApp } from "./app.ts";
import {
	evaluatePreviewReplicaConfig,
	startPreviewSessionSweeper,
} from "./services/preview-session-store.ts";

const app = createApp();

// Reap idle in-memory preview sessions. The timer is unref'd, so it never keeps
// the process alive on its own.
startPreviewSessionSweeper();

// Warn loudly if a multi-replica deployment has not acknowledged sticky routing
// for the process-local preview store (see ADR-0030).
const previewReplicaWarning = evaluatePreviewReplicaConfig();
if (previewReplicaWarning) {
	console.warn(`[preview] ${previewReplicaWarning}`);
}

export default {
	port: Number(process.env.PORT ?? 3000),
	fetch: app.fetch,
};

export { app };
