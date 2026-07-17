import { describe, expect, it } from "bun:test";
import * as legacyImport from "./index.ts";

describe("legacy-import barrel", () => {
	it("re-exports the public mapping/normalization API", () => {
		expect(typeof legacyImport.mapLegacyRecord).toBe("function");
		expect(typeof legacyImport.normalizeLanguage).toBe("function");
		expect(typeof legacyImport.normalizeLicense).toBe("function");
		expect(typeof legacyImport.mapResourceType).toBe("function");
		expect(typeof legacyImport.ensureLegacyImportSystemUser).toBe("function");
		expect(typeof legacyImport.LEGACY_IMPORT_SYSTEM_USER_ID).toBe("string");
	});
});
