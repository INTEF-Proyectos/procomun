import { describe, expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { getDb } from "../db.ts";
import { auditMiddleware, redactAuditPath } from "./audit.ts";
import type { AuthEnv } from "./middleware.ts";

describe("auditMiddleware", () => {
	test("never breaks the response flow", async () => {
		const path = `/api/audit-test-${crypto.randomUUID()}`;
		const app = new Hono<AuthEnv>();

		app.use("*", async (c, next) => {
			c.set("user", null);
			c.set("session", null);
			await next();
		});
		app.use("/api/*", auditMiddleware);
		app.get(path, (c) => c.json({ ok: true }));

		const response = await app.request(path, {
			headers: {
				"user-agent": "bun-test",
				"x-real-ip": "127.0.0.1",
			},
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
	});
});

// #536: api_access_logs guardaba la ruta entera, y en los enlaces firmados de
// los recursos no publicados (#466) el permiso va en la propia URL. Quien
// pudiera leer esa tabla podia abrir el contenido no publicado mientras el
// enlace no caducase (2 h).
describe("redactAuditPath (#536)", () => {
	const hash = "a".repeat(64);
	const token = "1762255200.c0ffee1234567890abcdef";

	test("tapa el token del enlace firmado y conserva el hash", () => {
		expect(
			redactAuditPath(`/api/v1/elpx/preview/${hash}/${token}/index.html`),
		).toBe(`/api/v1/elpx/preview/${hash}/:token/index.html`);
	});

	test("tapa el token tambien sin nada detras, con y sin barra final", () => {
		expect(redactAuditPath(`/api/v1/elpx/preview/${hash}/${token}/`)).toBe(
			`/api/v1/elpx/preview/${hash}/:token/`,
		);
		expect(redactAuditPath(`/api/v1/elpx/preview/${hash}/${token}`)).toBe(
			`/api/v1/elpx/preview/${hash}/:token`,
		);
	});

	test("tapa el token en subpaginas y subrecursos del paquete", () => {
		for (const rest of [
			"style/base.css",
			"libs/exe/js/app.js",
			"content/pagina-2.html",
			"img/foto%20con%20espacio.png",
		]) {
			expect(
				redactAuditPath(`/api/v1/elpx/preview/${hash}/${token}/${rest}`),
			).toBe(`/api/v1/elpx/preview/${hash}/:token/${rest}`);
		}
	});

	test("ninguna parte del token queda en la ruta registrada", () => {
		const registrada = redactAuditPath(
			`/api/v1/elpx/preview/${hash}/${token}/index.html`,
		);
		expect(registrada).not.toContain(token);
		expect(registrada).not.toContain("c0ffee");
	});

	test("la URL estable de un recurso publicado no se toca", () => {
		// /api/v1/elpx/<hash>/... no lleva token: el hash dice que recurso se vio.
		expect(redactAuditPath(`/api/v1/elpx/${hash}/index.html`)).toBe(
			`/api/v1/elpx/${hash}/index.html`,
		);
	});

	test("las demas rutas pasan sin cambios", () => {
		for (const path of [
			"/api/v1/resources",
			"/api/v1/resources/mi-recurso",
			"/api/admin/users",
			"/health",
			"/",
			"/api/v1/elpx/preview",
			`/api/v1/elpx/preview/${hash}`,
		]) {
			expect(redactAuditPath(path)).toBe(path);
		}
	});
});

// La comprobacion que de verdad importa: lo que el middleware manda escribir.
// La tabla api_access_logs no se crea en la base de test (setup.ts no la
// incluye) y el insert es fire-and-forget con el error tragado, asi que se
// espia el insert en vez de consultar la tabla.
describe("auditMiddleware escribe la ruta sin el token (#536)", () => {
	test("el valor insertado lleva :token en lugar del token", async () => {
		const hash = "a".repeat(64);
		const token = "1762255200.c0ffee1234567890abcdef";
		const requested = `/api/v1/elpx/preview/${hash}/${token}/index.html`;

		const db = getDb().db;
		const inserted: Array<{ path?: string }> = [];
		const insertSpy = spyOn(db, "insert").mockImplementation(
			() =>
				({
					values: (row: { path?: string }) => {
						inserted.push(row);
						return Promise.resolve();
					},
				}) as never,
		);

		try {
			const app = new Hono<AuthEnv>();
			app.use("*", async (c, next) => {
				c.set("user", null);
				c.set("session", null);
				await next();
			});
			app.use("/api/*", auditMiddleware);
			app.get("/api/v1/elpx/preview/:hash/:token/*", (c) =>
				c.json({ ok: true }),
			);

			expect((await app.request(requested)).status).toBe(200);
		} finally {
			insertSpy.mockRestore();
		}

		expect(inserted).toHaveLength(1);
		expect(inserted[0]?.path).toBe(
			`/api/v1/elpx/preview/${hash}/:token/index.html`,
		);
		expect(inserted[0]?.path).not.toContain(token);
	});
});
