import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { registerRoutes } from "./routes.ts";

describe("registerRoutes", () => {
	test("registers health and config endpoints", async () => {
		const app = new Hono<AuthEnv>();
		registerRoutes(app);

		const healthResponse = await app.request("/health");
		expect(healthResponse.status).toBe(200);
		expect(await healthResponse.json()).toEqual({ status: "ok" });

		const configResponse = await app.request("/api/v1/config");
		expect(configResponse.status).toBe(200);
		const config = await configResponse.json();
		expect(typeof config.oidcEnabled).toBe("boolean");
		expect(typeof config.emailVerificationRequired).toBe("boolean");
		expect("oidcEndSessionUrl" in config).toBe(true);
		// #551: la interfaz esconde la recuperación si no se puede mandar correo.
		expect(config.emailDeliveryEnabled).toBe(true);
	});

	test("expone mediaBankUrl desde MEDIA_BANK_URL (#569)", async () => {
		const previous = process.env.MEDIA_BANK_URL;
		try {
			const app = new Hono<AuthEnv>();
			registerRoutes(app);

			delete process.env.MEDIA_BANK_URL;
			let config = await (await app.request("/api/v1/config")).json();
			expect(config.mediaBankUrl).toBeNull();

			process.env.MEDIA_BANK_URL = "https://multimedia.example.es/";
			config = await (await app.request("/api/v1/config")).json();
			expect(config.mediaBankUrl).toBe("https://multimedia.example.es/");
		} finally {
			if (previous === undefined) delete process.env.MEDIA_BANK_URL;
			else process.env.MEDIA_BANK_URL = previous;
		}
	});

	test("expone el catálogo de áreas de conocimiento sin sesión (#448)", async () => {
		const app = new Hono<AuthEnv>();
		registerRoutes(app);
		const response = await app.request("/api/v1/knowledge-areas");
		expect(response.status).toBe(200);
		expect((await response.json()).blocks).toHaveLength(9);
	});
});
