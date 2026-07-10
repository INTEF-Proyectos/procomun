import { describe, expect, it } from "bun:test";
import path from "node:path";
import { mapLegacyRecord } from "./field-mapper.ts";
import type { LegacyOdeJson } from "./types.ts";

const FIXTURES_DIR = path.join(import.meta.dir, "../test-fixtures/legacy-procomun");

async function loadFixture(name: string): Promise<LegacyOdeJson> {
	return Bun.file(path.join(FIXTURES_DIR, `${name}.json`)).json();
}

describe("mapLegacyRecord", () => {
	it("maps a native MEC record (es_2025101012_9102834) but flags its invalid license combo as blocking", async () => {
		const json = await loadFixture("es_2025101012_9102834");
		const result = mapLegacyRecord(json, "fallback.elpx");

		expect(result.externalId).toBe("es_2025101012_9102834");
		expect(result.resource.title).toBe("Actividad Técnicas Estudio.pdf");
		expect(result.resource.language).toBe("es");
		expect(result.resource.subjects).toEqual(["Tutoría"]);
		expect(result.resource.levels).toEqual(["14 - 15 años / Tercer curso"]);
		expect(result.resource.resourceType).toBe("proyecto");
		expect(result.resource.sourceUri).toBe("https://ode.educacion.es/INTEF/es_2025101012_9102834");
		// rightsCopyrightAndOtherRestrictionsStr combina "non derived work" + "share alike",
		// una combinación de licencia CC inexistente -> bloqueante.
		expect(result.blocking).toBe(true);
		expect(result.resource.license).toBeNull();
		expect(result.blockingErrors.some((e) => e.includes("Licencia"))).toBe(true);
	});

	it("maps a native MEC record with rich metadata (es_2024052212_9181312) as importable", async () => {
		const json = await loadFixture("es_2024052212_9181312");
		const result = mapLegacyRecord(json, "fallback.elpx");

		expect(result.blocking).toBe(false);
		expect(result.resource.title).toBe("Manos a la obra");
		expect(result.resource.license).toBe("cc-by-nc-sa");
		expect(result.resource.language).toBe("es");
		expect(result.resource.subjects).toEqual(["Matemáticas"]);
		expect(result.resource.keywords).toBe("Geometría,áreas,polígonos,Facturas,plano");
		// authorStr es [""], cae al fallback publicatorNameStr.
		expect(result.resource.author).toBe("Docente Ejemplo Dos");
		expect(result.resource.publisher).toBe("Docente Ejemplo Dos");
	});

	it("maps a legacy Agrega record (1615293421477) recovering author from lifecycleContributeStr", async () => {
		const json = await loadFixture("1615293421477");
		const result = mapLegacyRecord(json, "fallback.elpx");

		expect(result.blocking).toBe(false);
		expect(result.resource.license).toBe("cc-by-sa");
		expect(result.resource.author).toBe("Docente Ejemplo Tres");
		// educationalLanguageStr es null y generalLanguageStr trae "es", debe reconocerse sin warning.
		expect(result.resource.language).toBe("es");
		expect(result.warnings.some((w) => w.field === "language")).toBe(false);
	});

	it("maps a legacy Agrega record with a Catalan language (1676602802114)", async () => {
		const json = await loadFixture("1676602802114");
		const result = mapLegacyRecord(json, "fallback.elpx");

		expect(result.blocking).toBe(false);
		expect(result.resource.language).toBe("ca");
		expect(result.resource.license).toBe("cc-by-nc-sa");
		// "Mapa conceptual" no está en el diccionario -> warning tolerable, no bloqueante.
		expect(result.warnings.some((w) => w.field === "resourceType")).toBe(true);
	});

	it("flags a missing description as blocking", () => {
		const result = mapLegacyRecord(
			{
				idODE: "es_test",
				titleStr: "Sin descripción",
				rightsCopyrightAndOtherRestrictionsStr: "creative commons: attribution",
			},
			"fallback.elpx",
		);

		expect(result.blocking).toBe(true);
		expect(result.blockingErrors.some((e) => e.includes("descriptionStr"))).toBe(true);
	});

	it("flags a missing external id as blocking and falls back to the .elpx filename for the title", () => {
		const result = mapLegacyRecord(
			{ descriptionStr: "d", rightsCopyrightAndOtherRestrictionsStr: "creative commons: attribution" },
			"nombre-del-archivo.elpx",
		);

		expect(result.blocking).toBe(true);
		expect(result.externalId).toBe("");
		expect(result.resource.title).toBe("nombre-del-archivo.elpx");
	});
});
