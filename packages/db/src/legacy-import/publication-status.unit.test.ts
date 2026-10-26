import { describe, expect, it } from "bun:test";
import { resolveLegacyPublicationStatus } from "./publication-status.ts";

describe("resolveLegacyPublicationStatus (issue #447)", () => {
	it("publica solo published = 1, numérico o texto", () => {
		expect(resolveLegacyPublicationStatus(1)).toEqual({
			editorialStatus: "published",
			sourcePublished: 1,
			recognized: true,
		});
		expect(resolveLegacyPublicationStatus("1")).toEqual({
			editorialStatus: "published",
			sourcePublished: "1",
			recognized: true,
		});
		expect(resolveLegacyPublicationStatus(" 1 ").editorialStatus).toBe(
			"published",
		);
	});

	it("published = 0, numérico o texto, se importa como borrador", () => {
		expect(resolveLegacyPublicationStatus(0)).toEqual({
			editorialStatus: "draft",
			sourcePublished: 0,
			recognized: true,
		});
		expect(resolveLegacyPublicationStatus("0")).toEqual({
			editorialStatus: "draft",
			sourcePublished: "0",
			recognized: true,
		});
	});

	it("un valor ausente, nulo o desconocido se importa como borrador y no se reconoce", () => {
		for (const value of [undefined, null, "", "si", 2, -1, true, {}]) {
			const result = resolveLegacyPublicationStatus(value);
			expect(result.editorialStatus).toBe("draft");
			expect(result.recognized).toBe(false);
		}
		expect(resolveLegacyPublicationStatus(undefined).sourcePublished).toBe(
			null,
		);
	});
});
