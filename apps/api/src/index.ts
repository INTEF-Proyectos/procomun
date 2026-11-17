import { createApp } from "./app.ts";
import { warmOidcEndSessionUrl } from "./auth/oidc-discovery.ts";

const app = createApp();

// #542: se consulta el documento de descubrimiento una vez al arrancar, para
// que /api/v1/config nunca espere a la red. Si falla, no impide arrancar: el
// endpoint sirve null y se reintenta en la siguiente petición.
if (import.meta.main) {
	void warmOidcEndSessionUrl().catch(() => {
		// Ya se reintentará: getCachedOidcEndSessionUrl relanza el calentado.
	});
}

export default {
	port: Number(process.env.PORT ?? 3000),
	fetch: app.fetch,
};

export { app };
