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

// El resto de URL con permiso en la ruta: la miniatura firmada de un recurso
// no publicado (#512) y la instantanea de la vista previa del editor (#317).
// Un solo helper para todas, para que #317 tome esta version al rebasar.
describe("redactAuditPath: otras URL con permiso en la ruta", () => {
	const id = "756f4e31-18e6-4f16-b868-516c5b945d8b";
	const token = "1762255200.c0ffee1234567890abcdef";
	const file = `${"b".repeat(64)}.jpg`;

	test("tapa el token de la miniatura firmada y conserva el fichero (#512)", () => {
		expect(redactAuditPath(`/api/v1/thumbnails/signed/${token}/${file}`)).toBe(
			`/api/v1/thumbnails/signed/:token/${file}`,
		);
		expect(redactAuditPath(`/api/v1/thumbnails/${file}`)).toBe(
			`/api/v1/thumbnails/${file}`,
		);
	});

	test("tapa el previewId de la vista previa y de su gestion (#317)", () => {
		expect(redactAuditPath(`/api/v1/preview/${id}/index.html`)).toBe(
			"/api/v1/preview/:previewId/index.html",
		);
		expect(redactAuditPath(`/api/v1/preview/${id}`)).toBe(
			"/api/v1/preview/:previewId",
		);
		expect(redactAuditPath(`/api/v1/preview-session/${id}/revisions`)).toBe(
			"/api/v1/preview-session/:previewId/revisions",
		);
		expect(redactAuditPath(`/api/v1/preview/${id.toUpperCase()}/x`)).toBe(
			"/api/v1/preview/:previewId/x",
		);
	});

	test("deja igual lo que no es un previewId (#317)", () => {
		for (const path of [
			"/api/v1/preview-session",
			"/api/v1/preview/not-a-uuid/x",
			`/api/v1/previewx/${id}`,
			`/x/api/v1/preview/${id}`,
		]) {
			expect(redactAuditPath(path)).toBe(path);
		}
	});

	test("no distingue mayusculas en el prefijo", () => {
		expect(
			redactAuditPath(`/API/V1/ELPX/PREVIEW/${"a".repeat(64)}/${token}/x`),
		).toBe(`/API/V1/ELPX/PREVIEW/${"a".repeat(64)}/:token/x`);
		expect(redactAuditPath(`/Api/v1/Thumbnails/Signed/${token}/${file}`)).toBe(
			`/Api/v1/Thumbnails/Signed/:token/${file}`,
		);
	});

	test("una ruta con escapes %xx llega ya decodificada al middleware", async () => {
		// nginx registra $request_uri en crudo, pero Hono decodifica c.req.path:
		// /api/v1/elpx/previe%77/... llega al registro como .../preview/...
		const hash = "a".repeat(64);
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
			app.get("/api/*", (c) => c.text("ok"));
			await app.request(`/api/v1/elpx/previe%77/${hash}/${token}/index.html`);
			await app.request(`/api/v1/thumbnails/%73igned/${token}/${file}`);
			await app.request(`/api/v1/preview/${id}/index.html`);
		} finally {
			insertSpy.mockRestore();
		}
		expect(inserted.map((r) => r.path)).toEqual([
			`/api/v1/elpx/preview/${hash}/:token/index.html`,
			`/api/v1/thumbnails/signed/:token/${file}`,
			"/api/v1/preview/:previewId/index.html",
		]);
		for (const { path } of inserted) {
			expect(path).not.toContain(token);
			expect(path).not.toContain(id);
		}
	});
});
