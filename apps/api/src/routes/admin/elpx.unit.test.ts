import { describe, expect, test } from "bun:test";
import {
	existsSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import type { AuthEnv } from "../../auth/middleware.ts";
import { elpxAdminRoutes } from "./elpx.ts";

const FIXTURES_DIR = path.resolve(import.meta.dir, "../../test-fixtures/elpx");

function createElpxApp(mockUser: Record<string, unknown> | null = null) {
	const app = new Hono<AuthEnv>();
	app.use("*", async (c, next) => {
		c.set("user", mockUser as AuthEnv["Variables"]["user"]);
		c.set(
			"session",
			mockUser ? ({ id: "s" } as AuthEnv["Variables"]["session"]) : null,
		);
		await next();
	});
	app.route("/api/admin/elpx", elpxAdminRoutes);
	return app;
}

describe("POST /api/admin/elpx/analyze", () => {
	const app = createElpxApp({ id: "1", role: "admin" });

	test("analiza un .elpx válido y extrae metadatos", async () => {
		const fixture = path.join(FIXTURES_DIR, "really-simple-test-project.elpx");
		const buf = readFileSync(fixture);
		const file = new File([buf], "really-simple-test-project.elpx", {
			type: "application/zip",
		});

		const form = new FormData();
		form.append("file", file);

		const res = await app.request("/api/admin/elpx/analyze", {
			method: "POST",
			body: form,
		});

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.filename).toBe("really-simple-test-project.elpx");
		expect(body.metadata).toBeDefined();
		expect(typeof body.metadata.title).toBe("string");
	});

	test("rechaza si no se envía archivo", async () => {
		const form = new FormData();
		const res = await app.request("/api/admin/elpx/analyze", {
			method: "POST",
			body: form,
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toContain(".elpx");
	});

	test("rechaza extensión no válida", async () => {
		const file = new File(["data"], "test.txt", { type: "text/plain" });
		const form = new FormData();
		form.append("file", file);

		const res = await app.request("/api/admin/elpx/analyze", {
			method: "POST",
			body: form,
		});
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error).toContain(".elpx");
	});

	test("rechaza archivo ZIP inválido (sin content.xml)", async () => {
		// Create a minimal ZIP with no content.xml
		const file = new File([new Uint8Array(100)], "broken.elpx", {
			type: "application/zip",
		});
		const form = new FormData();
		form.append("file", file);

		const res = await app.request("/api/admin/elpx/analyze", {
			method: "POST",
			body: form,
		});
		expect(res.status).toBe(400);
	});
});

describe("POST /api/admin/elpx/analyze — seguridad (path traversal, issue #249)", () => {
	// El rol por defecto "author" alcanza esta ruta.
	const app = createElpxApp({ id: "a1", role: "author" });

	test("no borra archivos fuera de la ruta temporal generada por el servidor", async () => {
		// Sentinel "víctima" colocado en el directorio temporal del sistema.
		// El código vulnerable construía la ruta como
		//   path.join(tmpdir(), `procomun-elpx-${Date.now()}-${file.name}`)
		// y un filename con doble "../" normaliza exactamente a <tmpdir>/<basename>,
		// es decir, a la ruta del sentinel, provocando su sobrescritura y borrado.
		const sentinelName = `elpx-victim-${crypto.randomUUID()}.elpx`;
		const sentinelPath = path.join(os.tmpdir(), sentinelName);
		const sentinelContent = "no-tocar-este-archivo";
		writeFileSync(sentinelPath, sentinelContent);

		try {
			// Nombre con traversal cuyo basename coincide con el sentinel.
			// Con el código antiguo, `procomun-elpx-<ts>-../../<basename>` se
			// resuelve a <tmpdir>/<basename> == sentinelPath.
			const traversalName = `../../${sentinelName}`;
			const attackerBytes = new Uint8Array([1, 2, 3, 4]); // no es un .elpx válido

			const form = new FormData();
			form.append("file", new File([attackerBytes], traversalName, { type: "application/zip" }));

			const res = await app.request("/api/admin/elpx/analyze", {
				method: "POST",
				body: form,
			});

			// El parseo fallará (bytes inválidos); lo relevante es que el sentinel
			// NO se vea afectado por la escritura/borrado de la ruta temporal.
			expect(res.status).toBe(400);

			// Invariante de seguridad: el archivo fuera de la ruta UUID del servidor
			// sigue existiendo y conserva su contenido original.
			expect(existsSync(sentinelPath)).toBe(true);
			expect(readFileSync(sentinelPath, "utf8")).toBe(sentinelContent);
		} finally {
			if (existsSync(sentinelPath)) unlinkSync(sentinelPath);
		}
	});
});

describe("POST /api/admin/elpx/analyze — sin auth", () => {
	const app = createElpxApp(null);

	test("requiere autenticación", async () => {
		const form = new FormData();
		form.append("file", new File(["x"], "test.elpx"));

		const res = await app.request("/api/admin/elpx/analyze", {
			method: "POST",
			body: form,
		});
		expect(res.status).toBe(401);
	});
});
