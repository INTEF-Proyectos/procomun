import { describe, expect, test } from "bun:test";
import { newStatusKey, STATUS_TASK_KEY_RE } from "./new-status-key.ts";

describe("newStatusKey", () => {
	test("genera T-YYYY-MM-DD-HHMMSSrr en UTC", () => {
		// 2026-07-17 16:05:13.000Z → 160513 + rr
		const now = new Date("2026-07-17T16:05:13.000Z");
		const key = newStatusKey({ now, random: () => 0.42 });
		expect(key).toBe("T-2026-07-17-16051342");
		expect(STATUS_TASK_KEY_RE.test(key)).toBe(true);
	});

	test("los dos dígitos aleatorios van de 00 a 99", () => {
		const now = new Date("2026-01-01T00:00:00.000Z");
		expect(newStatusKey({ now, random: () => 0 })).toBe(
			"T-2026-01-01-00000000",
		);
		// 0.999 → floor 99
		expect(newStatusKey({ now, random: () => 0.999 })).toBe(
			"T-2026-01-01-00000099",
		);
	});

	test("dos llamadas con distinto random no colisionan (caso típico de ramas paralelas)", () => {
		const now = new Date("2026-07-17T12:00:00.000Z");
		const a = newStatusKey({ now, random: () => 0.1 });
		const b = newStatusKey({ now, random: () => 0.9 });
		expect(a).not.toBe(b);
		expect(a).toBe("T-2026-07-17-12000010");
		expect(b).toBe("T-2026-07-17-12000090");
	});

	test("el formato antiguo NNN y el nuevo HHMMSSrr pasan el mismo patrón", () => {
		expect(STATUS_TASK_KEY_RE.test("T-2026-07-17-011")).toBe(true);
		expect(STATUS_TASK_KEY_RE.test("T-2026-07-17-16051342")).toBe(true);
		expect(STATUS_TASK_KEY_RE.test("T-2026-07-17-abc")).toBe(false);
		expect(STATUS_TASK_KEY_RE.test("ADR-0019")).toBe(false);
	});
});
