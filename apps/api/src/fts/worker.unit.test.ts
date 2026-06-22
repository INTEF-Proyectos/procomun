/**
 * Tests for FTS worker module.
 * Worker functions depend on getDb() and file system; integration paths are
 * tested via admin route tests (admin.unit.test.ts).
 */
import { describe, expect, test } from "bun:test";
import { enqueueExtraction, processExtraction, reExtractResource } from "./worker.ts";

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
