import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { registerFrontendServing } from "./frontend.ts";

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
		const frontendDir = await mkdtemp(
			path.join(tmpdir(), "procomun-frontend-"),
		);
		await writeFile(
			path.join(frontendDir, "index.html"),
			"<html><body>frontend ok</body></html>",
		);

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
			await writeFile(
				path.join(dir, "index.html"),
				"<html><body>frontend ok</body></html>",
			);
			await mkdir(path.join(dir, "dev", "data"), { recursive: true });
			await writeFile(
				path.join(dir, "dev", "data", "status.yaml"),
				"internal: secret\n",
			);
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

		test("blocks /dev exactly and case variants outside development", async () => {
			process.env.NODE_ENV = "production";
			frontendDir = await buildDevDir();
			await writeFile(
				path.join(frontendDir, "dev", "index.html"),
				"<html><body>dev dash</body></html>",
			);

			const app = new Hono<AuthEnv>();
			registerFrontendServing(app, frontendDir);

			for (const p of [
				"/dev",
				"/dev/",
				"/dev/index.html",
				"/Dev/data/status.yaml",
				"/DEV/data/status.yaml",
			]) {
				const response = await app.request(p);
				expect(response.status).toBe(404);
				const body = await response.text();
				expect(body).not.toContain("internal: secret");
				expect(body).not.toContain("dev dash");
			}
		});

		test("blocks percent-encoded /dev variants outside development", async () => {
			process.env.NODE_ENV = "production";
			frontendDir = await buildDevDir();
			await writeFile(
				path.join(frontendDir, "dev", "index.html"),
				"<html><body>dev dash</body></html>",
			);

			const app = new Hono<AuthEnv>();
			registerFrontendServing(app, frontendDir);

			for (const p of [
				"/%64ev/data/status.yaml",
				"/%44ev/data/status.yaml",
				"/de%76/data/status.yaml",
				"/%64%65%76/data/status.yaml",
				"/%2fdev/data/status.yaml",
				"/dev%2fdata/status.yaml",
				"/%64ev",
				"/%64ev/",
				"/%64ev/index.html",
			]) {
				const response = await app.request(`http://localhost${p}`);
				const body = await response.text();
				expect(body).not.toContain("internal: secret");
				expect(body).not.toContain("dev dash");
				expect(response.status).toBe(404);
			}
		});

		test("returns 404 when the request path cannot be decoded", async () => {
			process.env.NODE_ENV = "production";
			frontendDir = await buildDevDir();

			const app = new Hono<AuthEnv>();
			registerFrontendServing(app, frontendDir);

			const response = await app.request("http://localhost/%E0%A4%A");
			expect(response.status).toBe(404);
		});

		test("returns 404 for paths with null bytes instead of crashing", async () => {
			frontendDir = await buildDevDir();

			for (const nodeEnv of ["production", "development"]) {
				process.env.NODE_ENV = nodeEnv;
				const app = new Hono<AuthEnv>();
				registerFrontendServing(app, frontendDir);

				for (const p of ["/dev%00/data/status.yaml", "/assets%00.js"]) {
					const response = await app.request(`http://localhost${p}`);
					expect(response.status).toBe(404);
				}
			}
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
