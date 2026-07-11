import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { registerGlobalMiddleware } from "./middleware.ts";

describe("registerGlobalMiddleware", () => {
	test("applies CORS headers on API routes", async () => {
		const app = new Hono<AuthEnv>();
		registerGlobalMiddleware(app);
		app.get("/api/ping", (c) => c.json({ ok: true }));

		const response = await app.request("/api/ping", {
			headers: { Origin: "http://localhost:5173" },
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
		expect(response.headers.get("access-control-allow-credentials")).toBe("true");
	});

	test("does not override the authless preview serving route's ACAO:*", async () => {
		const app = new Hono<AuthEnv>();
		registerGlobalMiddleware(app);
		// Stand-in for the real serving route, which sets its own ACAO:* for the
		// opaque (Origin: null) frame. The credentialed app CORS policy must not
		// overwrite it — otherwise the null-origin subresource fetches are blocked.
		app.get(
			"/api/v1/preview/:id/*",
			() =>
				new Response("body", {
					headers: { "Access-Control-Allow-Origin": "*" },
				}),
		);

		const res = await app.request(
			"/api/v1/preview/756f4e31-18e6-4f16-b868-516c5b945d8b/index.html",
			{ headers: { Origin: "null" } },
		);
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
		expect(res.headers.get("access-control-allow-credentials")).toBeNull();
	});

	test("still applies credentialed CORS to preview-session management", async () => {
		// The exclusion is scoped to `/api/v1/preview/`, NOT `/api/v1/preview-session/`
		// (management is frontend-origin and credentialed).
		const app = new Hono<AuthEnv>();
		registerGlobalMiddleware(app);
		app.get("/api/v1/preview-session/:id", (c) => c.json({ ok: true }));

		const res = await app.request(
			"/api/v1/preview-session/756f4e31-18e6-4f16-b868-516c5b945d8b",
			{ headers: { Origin: "http://localhost:5173" } },
		);
		expect(res.headers.get("access-control-allow-origin")).toBe(
			"http://localhost:5173",
		);
		expect(res.headers.get("access-control-allow-credentials")).toBe("true");
	});
});
