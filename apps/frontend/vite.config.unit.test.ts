import { describe, expect, test } from "bun:test";
import config from "./vite.config.ts";

describe("frontend Vite config", () => {
	test("mantiene proxy de API y excluye PGlite de optimizeDeps", () => {
		if (typeof config === "function") {
			throw new Error("Expected static Vite config object.");
		}

		const proxy = config.server?.proxy;
		expect(proxy).toBeDefined();
		expect(JSON.stringify(proxy)).toContain("http://localhost:3000");
		expect(config.optimizeDeps?.exclude).toContain("@electric-sql/pglite");
	});

	test("configura soporte del dashboard dev antes de plugins de framework", () => {
		if (typeof config === "function") {
			throw new Error("Expected static Vite config object.");
		}

		const plugins = Array.isArray(config.plugins) ? config.plugins : [];
		expect(plugins[0]).toMatchObject({ name: "dev-dashboard-support" });
	});
});
