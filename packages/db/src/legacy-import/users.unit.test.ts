import { describe, expect, test } from "bun:test";
import { mapLegacyUser } from "./users.ts";

describe("mapLegacyUser", () => {
	test("mapea administrator legacy a admin con ID destino estable", () => {
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

	test("asigna editor al resto y mantiene activa la cuenta aunque status sea 0", () => {
		const mapped = mapLegacyUser({
			uid: "7",
			mail: "reader@example.test",
			roles: "-",
			status: 0,
		});

		expect(mapped.role).toBe("editor");
		expect(mapped.isActive).toBeTrue();
		expect(mapped.warnings).toEqual([]);
	});

	test("mantiene activa la cuenta aunque status esté ausente", () => {
		const mapped = mapLegacyUser({
			uid: "8",
			mail: "active@example.test",
			roles: "-",
		});

		expect(mapped.isActive).toBeTrue();
	});

	test("rechaza uid o email no utilizables", () => {
		expect(() => mapLegacyUser({ mail: "user@example.test" })).toThrow("uid");
		expect(() => mapLegacyUser({ uid: 1, mail: "incorrecto" })).toThrow("mail");
	});
});
