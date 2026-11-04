import { describe, expect, test } from "bun:test";
import { REGISTRATION_ROLE, resolveNewUserRole } from "./registration-role.ts";

describe("resolveNewUserRole (#515)", () => {
	test("el rol de registro es editor", () => {
		expect(REGISTRATION_ROLE).toBe("editor");
	});

	test("el registro con email y contraseña siempre da editor", () => {
		expect(resolveNewUserRole(undefined, "/sign-up/email")).toBe("editor");
		expect(resolveNewUserRole("admin", "/sign-up/email")).toBe("editor");
		expect(resolveNewUserRole("curator", "/sign-up/email")).toBe("editor");
	});

	test("el primer inicio de sesión OIDC siempre da editor", () => {
		expect(resolveNewUserRole("author", "/callback/:id")).toBe("editor");
		expect(resolveNewUserRole("admin", "/callback/:id")).toBe("editor");
	});

	test("sin endpoint conocido no se acepta el rol pedido", () => {
		expect(resolveNewUserRole("admin", undefined)).toBe("editor");
		expect(resolveNewUserRole(undefined, undefined)).toBe("editor");
	});

	test("el alta del plugin admin conserva el rol que elige el administrador", () => {
		expect(resolveNewUserRole("curator", "/admin/create-user")).toBe("curator");
		expect(resolveNewUserRole("author", "/admin/create-user")).toBe("author");
	});

	test("el alta del plugin admin sin rol válido cae en editor", () => {
		expect(resolveNewUserRole(undefined, "/admin/create-user")).toBe("editor");
		expect(resolveNewUserRole("", "/admin/create-user")).toBe("editor");
		expect(resolveNewUserRole(["admin"], "/admin/create-user")).toBe("editor");
	});
});
