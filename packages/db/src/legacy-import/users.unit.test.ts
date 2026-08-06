import { describe, expect, test } from "bun:test";
import { mapLegacyUser } from "./users.ts";

describe("mapLegacyUser", () => {
	test("mapea uid, email, estado y administrator a un usuario destino estable", () => {
		expect(
			mapLegacyUser({
				uid: 42,
				name: " Ada Lovelace ",
				mail: " ADA@EXAMPLE.TEST ",
				roles: "administrator",
				status: 1,
			}),
		).toMatchObject({
			legacyUid: "42",
			id: "legacy-procomun:user:42",
			email: "ada@example.test",
			name: "Ada Lovelace",
			role: "admin",
			isActive: true,
		});
	});

	test("asigna author para el marcador de rol y conserva un usuario inactivo", () => {
		const mapped = mapLegacyUser({
			uid: "7",
			mail: "reader@example.test",
			roles: "-",
			status: 0,
		});

		expect(mapped.role).toBe("author");
		expect(mapped.isActive).toBeFalse();
		expect(mapped.warnings).toEqual([]);
	});

	test("rechaza uid o email no utilizables", () => {
		expect(() => mapLegacyUser({ mail: "user@example.test" })).toThrow("uid");
		expect(() => mapLegacyUser({ uid: 1, mail: "incorrecto" })).toThrow("mail");
	});
});
