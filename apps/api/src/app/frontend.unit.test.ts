import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { registerFrontendServing } from "./frontend.ts";
import type { AuthEnv } from "../auth/middleware.ts";

describe("registerFrontendServing", () => {
	test("returns API metadata when no frontend directory is configured", async () => {
		const app = new Hono<AuthEnv>();
		registerFrontendServing(app);

		const response = await app.request("/");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			name: "Procomun API",
			version: "0.1.0",
		});
	});

	test("serves the frontend index when a static directory is provided", async () => {
		const frontendDir = await mkdtemp(path.join(tmpdir(), "procomun-frontend-"));
		await writeFile(path.join(frontendDir, "index.html"), "<html><body>frontend ok</body></html>");

		const app = new Hono<AuthEnv>();
		registerFrontendServing(app, frontendDir);

		const response = await app.request("/cualquier/ruta");
		expect(response.status).toBe(200);
		expect(await response.text()).toContain("frontend ok");
	});

	describe("dev dashboard exposure", () => {
		const originalNodeEnv = process.env.NODE_ENV;
		let frontendDir: string | undefined;

		afterEach(async () => {
			if (originalNodeEnv === undefined) {
				delete process.env.NODE_ENV;
			} else {
				process.env.NODE_ENV = originalNodeEnv;
			}
			if (frontendDir) {
				await rm(frontendDir, { recursive: true, force: true });
				frontendDir = undefined;
			}
		});

		async function buildDevDir() {
			const dir = await mkdtemp(path.join(tmpdir(), "procomun-frontend-dev-"));
			await writeFile(path.join(dir, "index.html"), "<html><body>frontend ok</body></html>");
			await mkdir(path.join(dir, "dev", "data"), { recursive: true });
			await writeFile(path.join(dir, "dev", "data", "status.yaml"), "internal: secret\n");
			return dir;
		}

		test("does not serve /dev internal data outside development", async () => {
			process.env.NODE_ENV = "test";
			frontendDir = await buildDevDir();

			const app = new Hono<AuthEnv>();
			registerFrontendServing(app, frontendDir);

			const response = await app.request("/dev/data/status.yaml");
			expect(response.status).toBe(404);
		});

		test("serves /dev internal data only in development", async () => {
			process.env.NODE_ENV = "development";
			frontendDir = await buildDevDir();

			const app = new Hono<AuthEnv>();
			registerFrontendServing(app, frontendDir);

			const response = await app.request("/dev/data/status.yaml");
			expect(response.status).toBe(200);
			expect(await response.text()).toContain("internal: secret");
		});
	});
});
