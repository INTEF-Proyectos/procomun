import { describe, expect, test } from "bun:test";

import { ftsReindex, loadFtsReindexDependencies } from "./fts-reindex.ts";

describe("ftsReindex", () => {
	test("carga el comando y expone el handler CLI", () => {
		expect(ftsReindex).toBeFunction();
	});

	test("resuelve dependencias API/FTS diferidas", async () => {
		const dependencies = await loadFtsReindexDependencies();

		expect(dependencies.getDb).toBeFunction();
		expect(dependencies.waitForDb).toBeFunction();
		expect(dependencies.reindexAllResources).toBeFunction();
	});
});
