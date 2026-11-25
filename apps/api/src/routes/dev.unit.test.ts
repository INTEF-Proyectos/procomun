import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { resources } from "@procomun/db/schema";
import { like } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { getDb } from "../db.ts";
import { devRoutes } from "./dev.ts";

function createDevApp(
	mockUser: Record<string, unknown> | null = null,
	nodeEnv = "development",
	bunNodeEnv?: string,
) {
	const app = new Hono<AuthEnv>();
	app.use("*", async (c, next) => {
		c.set("user", mockUser as AuthEnv["Variables"]["user"]);
		c.set(
			"session",
			mockUser ? ({ id: "s" } as AuthEnv["Variables"]["session"]) : null,
		);
		if (nodeEnv === undefined) {
			delete process.env.NODE_ENV;
		} else {
			process.env.NODE_ENV = nodeEnv;
		}
		if (bunNodeEnv !== undefined) {
			Bun.env.NODE_ENV = bunNodeEnv;
		} else if (nodeEnv !== undefined) {
			Bun.env.NODE_ENV = nodeEnv;
		} else {
			delete Bun.env.NODE_ENV;
		}
		await next();
	});
	app.route("/api/dev", devRoutes);
	return app;
}

describe("Rutas dev — modo desarrollo", () => {
	setDefaultTimeout(60_000);
	const app = createDevApp({ id: "1", role: "admin" });

	test(
		"POST /api/dev/seed-resources → 200 con count válido",
		async () => {
			const res = await app.request("/api/dev/seed-resources", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ count: 10 }),
			});
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.count).toBe(10);
			expect(body.durationMs).toBeDefined();
		},
		{ timeout: 30_000 },
	);

	test(
		"POST /api/dev/seed-resources → 200 con clean=true",
		async () => {
			// Primero generamos algunos
			await app.request("/api/dev/seed-resources", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ count: 10 }),
			});

			// Luego limpiamos y generamos 100
			const res = await app.request("/api/dev/seed-resources", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ count: 100, clean: true }),
			});
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.count).toBe(100);
		},
		{ timeout: 60_000 },
	);

	test(
		"los publicados aleatorios llevan el sello «Validado» y el resto no (#568)",
		async () => {
			const res = await app.request("/api/dev/seed-resources", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ count: 100, clean: true }),
			});
			expect(res.status).toBe(200);
			const rows = await getDb()
				.db.select({
					status: resources.editorialStatus,
					validatedAt: resources.validatedAt,
					source: resources.validationSource,
				})
				.from(resources)
				.where(like(resources.externalId, "seed-%"));
			const published = rows.filter((r) => r.status === "published");
			expect(published.length).toBeGreaterThan(0);
			for (const r of published) {
				expect(r.validatedAt).not.toBeNull();
				expect(r.source).toBe("review");
			}
			for (const r of rows.filter((r) => r.status !== "published")) {
				expect(r.validatedAt).toBeNull();
				expect(r.source).toBeNull();
			}
		},
		{ timeout: 60_000 },
	);

	test("POST /api/dev/seed-resources → 400 con count inválido", async () => {
		const res = await app.request("/api/dev/seed-resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ count: 5 }),
		});
		expect(res.status).toBe(400);
	});

	test("POST /api/dev/seed-resources → 401 sin sesión", async () => {
		const noAuthApp = createDevApp(null);
		const res = await noAuthApp.request("/api/dev/seed-resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ count: 10 }),
		});
		expect(res.status).toBe(401);
	});

	test("POST /api/dev/seed-resources → 403 con rol insuficiente", async () => {
		const authorApp = createDevApp({ id: "1", role: "author" });
		const res = await authorApp.request("/api/dev/seed-resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ count: 10 }),
		});
		expect(res.status).toBe(403);
	});
});

describe("Rutas dev — modo producción", () => {
	setDefaultTimeout(60_000);
	test("POST /api/dev/seed-resources → 403 siempre en producción", async () => {
		const app = createDevApp({ id: "1", role: "admin" }, "production");
		const res = await app.request("/api/dev/seed-resources", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ count: 10 }),
		});
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error).toBe("Solo disponible en modo desarrollo");
	});

	test(
		"POST /api/dev/seed-resources → 200 si Bun.env.NODE_ENV=development",
		async () => {
			const app = createDevApp(
				{ id: "1", role: "admin" },
				undefined,
				"development",
			);
			const res = await app.request("/api/dev/seed-resources", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ count: 10 }),
			});
			expect(res.status).toBe(200);
		},
		{ timeout: 60_000 },
	);
});
