import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { previewRoutes } from "../routes/preview.ts";
import * as fixedResources from "../services/preview-fixed-resources.ts";
import {
	applyRevision,
	createSession,
	getSessionForServing,
	resetDependencies,
} from "../services/preview-session-store.ts";
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

	// End-to-end guard against the "* + credentials" contract violation: the REAL
	// serving route under the REAL global middleware must ship ACAO:* and NEVER an
	// Access-Control-Allow-Credentials header (which the browser rejects when
	// paired with `*`, and which would be a live leak the moment serving read a
	// cookie). Covers both a normal request and the opaque frame's Origin: null.
	test("real serving route under global middleware: ACAO:* and NO credentials", async () => {
		resetDependencies();
		try {
			const app = new Hono<AuthEnv>();
			registerGlobalMiddleware(app);
			app.route("/api/v1/preview", previewRoutes);

			const { previewId } = createSession("owner-cors");
			const session = getSessionForServing(previewId);
			if (!session) throw new Error("expected a live session");
			const result = applyRevision(
				session,
				{
					baseRevision: 0,
					nextRevision: 1,
					writes: [
						{
							path: "index.html",
							bytes: new TextEncoder().encode("<html>hi</html>"),
						},
					],
					deletes: [],
					assetRefs: {},
					fixedRefs: {},
				},
				fixedResources,
			);
			expect("active" in result).toBe(true);

			for (const origin of [undefined, "null"]) {
				const res = await app.request(
					`/api/v1/preview/${previewId}/index.html`,
					origin ? { headers: { Origin: origin } } : {},
				);
				expect(res.status, `origin ${origin}`).toBe(200);
				expect(
					res.headers.get("access-control-allow-origin"),
					`origin ${origin}`,
				).toBe("*");
				expect(
					res.headers.get("access-control-allow-credentials"),
					`origin ${origin}`,
				).toBeNull();
			}
		} finally {
			resetDependencies();
		}
	});
});
