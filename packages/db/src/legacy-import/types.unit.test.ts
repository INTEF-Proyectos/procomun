import { describe, expect, it } from "bun:test";
import type {
	LegacyOdeJson,
	MappedLegacyResource,
	MappingResult,
	MappingWarning,
} from "./types.ts";

describe("legacy-import types", () => {
	it("LegacyOdeJson accepts a minimal real-world shape", () => {
		const sample: LegacyOdeJson = {
			id: "es_2025101012_9102834",
			idODE: "es_2025101012_9102834",
			titleStr: "Actividad Técnicas Estudio.pdf",
			knowledgeArea: ["Tutoría"],
			authorStr: [""],
			generalLanguageStr: ["es"],
		};

		expect(sample.idODE).toBe("es_2025101012_9102834");
		expect(sample.knowledgeArea).toEqual(["Tutoría"]);
	});

	it("MappedLegacyResource/MappingResult compose without runtime coupling", () => {
		const warning: MappingWarning = { field: "language", message: "guessed" };
		const resource: MappedLegacyResource = {
			externalId: "es_x",
			importSource: "legacy-procomun",
			sourceUri: null,
			title: "t",
			description: "d",
			language: "es",
			license: "cc-by",
			resourceType: "documento",
			subjects: [],
			levels: [],
			author: null,
			publisher: null,
			keywords: null,
			importedAt: null,
			previewImageUrl: null,
			editorialStatus: "draft",
			sourcePublished: null,
		};
		const result: MappingResult = {
			externalId: "es_x",
			blocking: false,
			blockingErrors: [],
			warnings: [warning],
			resource,
		};

		expect(result.blocking).toBe(false);
		expect(result.resource.importSource).toBe("legacy-procomun");
		expect(result.warnings[0]?.field).toBe("language");
	});
});
