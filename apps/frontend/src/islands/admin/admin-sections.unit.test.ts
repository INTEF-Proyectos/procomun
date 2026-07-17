import { describe, expect, test } from "bun:test";
import { ROLE_LEVELS } from "../../lib/shared-utils.ts";
import { resolveAdminSection, SECTION_MIN_ROLE } from "./admin-sections.ts";

describe("resolveAdminSection (DEF-021)", () => {
	test("un curator que pide ?section=users es redirigido al dashboard", () => {
		expect(resolveAdminSection("users", ROLE_LEVELS.curator)).toBe("dashboard");
	});

	test("un admin sí puede acceder a la sección de usuarios", () => {
		expect(resolveAdminSection("users", ROLE_LEVELS.admin)).toBe("users");
	});

	test("las secciones permitidas para curator se respetan", () => {
		expect(resolveAdminSection("collections", ROLE_LEVELS.curator)).toBe(
			"collections",
		);
		expect(resolveAdminSection("reports", ROLE_LEVELS.curator)).toBe("reports");
		expect(resolveAdminSection("categories", ROLE_LEVELS.curator)).toBe(
			"categories",
		);
	});

	test("api-tokens solo es accesible para admin", () => {
		expect(resolveAdminSection("api-tokens", ROLE_LEVELS.curator)).toBe(
			"dashboard",
		);
		expect(resolveAdminSection("api-tokens", ROLE_LEVELS.admin)).toBe(
			"api-tokens",
		);
	});

	test("secciones desconocidas o vacías caen en el dashboard", () => {
		expect(resolveAdminSection("loquesea", ROLE_LEVELS.admin)).toBe(
			"dashboard",
		);
		expect(resolveAdminSection(null, ROLE_LEVELS.admin)).toBe("dashboard");
		expect(resolveAdminSection(undefined, ROLE_LEVELS.admin)).toBe("dashboard");
	});

	test("el mapa de roles mínimos exige admin para users y api-tokens", () => {
		expect(SECTION_MIN_ROLE.users).toBe(ROLE_LEVELS.admin);
		expect(SECTION_MIN_ROLE["api-tokens"]).toBe(ROLE_LEVELS.admin);
		expect(SECTION_MIN_ROLE.dashboard).toBe(ROLE_LEVELS.curator);
	});
});
