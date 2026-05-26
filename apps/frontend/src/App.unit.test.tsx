import { describe, expect, test } from "bun:test";
import { canAccessAdminPanel } from "./App.tsx";

describe("App admin access helpers", () => {
	test("solo curator y admin pueden acceder al panel admin", () => {
		expect(canAccessAdminPanel("reader")).toBe(false);
		expect(canAccessAdminPanel("author")).toBe(false);
		expect(canAccessAdminPanel("editor")).toBe(false);
		expect(canAccessAdminPanel("curator")).toBe(true);
		expect(canAccessAdminPanel("admin")).toBe(true);
		expect(canAccessAdminPanel(undefined)).toBe(false);
	});
});
