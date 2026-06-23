/**
 * Tests for FTS worker module.
 * Worker functions depend on getDb() and file system; integration paths are
 * tested via admin route tests (admin.unit.test.ts).
 */
import { describe, expect, test } from "bun:test";
import { enqueueExtraction, processExtraction, reExtractResource, sanitizeForLog } from "./worker.ts";

describe("FTS Worker — module exports", () => {
	test("enqueueExtraction is a function", () => {
		expect(typeof enqueueExtraction).toBe("function");
	});

	test("processExtraction is a function", () => {
		expect(typeof processExtraction).toBe("function");
	});

	test("reExtractResource is a function", () => {
		expect(typeof reExtractResource).toBe("function");
	});
});

describe("FTS Worker — sanitizeForLog", () => {
	test("neutraliza CR/LF para evitar inyección de líneas de log", () => {
		const sanitized = sanitizeForLog("evil\r\n[fts] línea falsa");
		expect(sanitized).not.toContain("\r");
		expect(sanitized).not.toContain("\n");
		expect(sanitized).toBe("evil??[fts] línea falsa");
	});

	test("neutraliza NUL, caracteres de control y secuencias ANSI", () => {
		expect(sanitizeForLog(`a${String.fromCharCode(0)}b`)).toBe("a?b");
		expect(sanitizeForLog(`a${String.fromCharCode(27)}[31mrojo`)).toBe("a?[31mrojo");
		expect(sanitizeForLog(`a${String.fromCharCode(127)}b`)).toBe("a?b");
	});

	test("no altera nombres legítimos", () => {
		expect(sanitizeForLog("informe final.pdf")).toBe("informe final.pdf");
	});
});
