import { createApp } from "./app.ts";
import { warmOidcEndSessionUrl } from "./auth/oidc-discovery.ts";
import {
	evaluatePreviewReplicaConfig,
	startPreviewSessionSweeper,
} from "./services/preview-snapshot-store.ts";

const app = createApp();

// Reap idle in-memory preview snapshots. The timer is unref'd, so it never keeps
// the process alive on its own.
startPreviewSessionSweeper();

// Warn loudly if a multi-replica deployment has not acknowledged sticky routing
// for the process-local preview store (see ADR-0038).
const previewReplicaWarning = evaluatePreviewReplicaConfig();
if (previewReplicaWarning) {
	console.warn(`[preview] ${previewReplicaWarning}`);
}

// #542: se consulta el documento de descubrimiento una vez al arrancar, para
// que /api/v1/config nunca espere a la red. Si falla, no impide arrancar: el
// endpoint sirve null y se reintenta en la siguiente petición.
if (import.meta.main) {
	void warmOidcEndSessionUrl().catch(() => {
		// Ya se reintentará: getCachedOidcEndSessionUrl relanza el calentado.
	});
}

export function resolveMaxRequestBodySize(
	env: NodeJS.ProcessEnv = process.env,
): number {
	const fallback = 256 * 1024 * 1024;
	const parsed = Number(env.API_MAX_REQUEST_BODY_BYTES ?? fallback);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export default {
	port: Number(process.env.PORT ?? 3000),
	fetch: app.fetch,
	// This is enforced by Bun before Hono/formData materializes a request body.
	// Preview routes add a tighter Content-Length guard based on session limits.
	maxRequestBodySize: resolveMaxRequestBodySize(),
};

export { app };
