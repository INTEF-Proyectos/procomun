import { describe, expect, it } from "bun:test";
import path from "node:path";
import { mapLegacyRecord, resolveLegacyExternalId } from "./field-mapper.ts";
import type { LegacyOdeJson } from "./types.ts";

const FIXTURES_DIR = path.join(
	import.meta.dir,
	"../test-fixtures/legacy-procomun",
);

async function loadFixture(name: string): Promise<LegacyOdeJson> {
	return Bun.file(path.join(FIXTURES_DIR, `${name}.json`)).json();
}

describe("mapLegacyRecord", () => {
	it("maps a native MEC record (es_2025101012_9102834), resolving its ND+SA license combo to cc-by-nc-sa with a warning", async () => {
		const json = await loadFixture("es_2025101012_9102834");
		const result = mapLegacyRecord(json, "fallback.elpx");

		expect(result.externalId).toBe("es_2025101012_9102834");
		expect(result.resource.title).toBe("Actividad Técnicas Estudio.pdf");
		expect(result.resource.language).toBe("es");
		expect(result.resource.subjects).toEqual(["Tutoría"]);
		expect(result.resource.levels).toEqual(["14 - 15 años / Tercer curso"]);
		expect(result.resource.resourceType).toBe("proyecto");
		expect(result.resource.sourceUri).toBe(
			"https://ode.educacion.es/INTEF/es_2025101012_9102834",
		);
		// rightsCopyrightAndOtherRestrictionsStr combina "non derived work" + "share alike",
		// una combinación de licencia CC inexistente (ND y SA son mutuamente
		// excluyentes) -> se resuelve priorizando SA sobre ND, no bloqueante
		// (decisión de negocio confirmada, ver ADR-0029).
		expect(result.blocking).toBe(false);
		expect(result.resource.license).toBe("cc-by-nc-sa");
		expect(result.blockingErrors).toHaveLength(0);
		expect(result.warnings).toContainEqual({
			field: "license",
			message:
				'Licencia de origen combinaba "no derivadas" y "compartir igual" (mutuamente excluyentes en Creative Commons real); se asume "cc-by-nc-sa" priorizando "compartir igual"',
		});
	});

	it("maps a native MEC record with rich metadata (es_2024052212_9181312) as importable", async () => {
		const json = await loadFixture("es_2024052212_9181312");
		const result = mapLegacyRecord(json, "fallback.elpx");

		expect(result.blocking).toBe(false);
		expect(result.resource.title).toBe("Manos a la obra");
		expect(result.resource.license).toBe("cc-by-nc-sa");
		expect(result.resource.language).toBe("es");
		expect(result.resource.subjects).toEqual(["Matemáticas"]);
		expect(result.resource.keywords).toBe(
			"Geometría,áreas,polígonos,Facturas,plano",
		);
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
		// "Mapa conceptual" tiene ahora equivalencia propia en el diccionario
		// (ver ADR-0029, actualización 2026-07-16): ya no cae a slug de
		// fallback ni genera warning de resourceType.
		expect(result.resource.resourceType).toBe("mapa-conceptual");
		expect(result.warnings.some((w) => w.field === "resourceType")).toBe(false);
	});

	it("leaves the language empty when the source only has the target-user language (issue #473)", () => {
		// Caso es_2026061012_9170321: recurso en inglés sin generalLanguageStr;
		// «Idioma destinatario» (educationalLanguageStr) es el idioma del
		// alumnado, no el del recurso.
		const result = mapLegacyRecord(
			{
				idODE: "es_2026061012_9170321",
				titleStr: "Bring your book to the 21st century",
				descriptionStr: "d",
				rightsCopyrightAndOtherRestrictionsStr: "creative commons: attribution",
				educationalLanguageStr: ["es"],
			},
			"fallback.elpx",
		);

		expect(result.blocking).toBe(false);
		expect(result.resource.language).toBeNull();
		expect(result.warnings.some((w) => w.field === "language")).toBe(true);
	});

	it("maps the legacy Valencian code «va» to Catalan instead of Spanish (issue #473)", () => {
		const result = mapLegacyRecord(
			{
				idODE: "es_va",
				descriptionStr: "d",
				rightsCopyrightAndOtherRestrictionsStr: "creative commons: attribution",
				generalLanguageStr: ["va"],
			},
			"fallback.elpx",
		);

		expect(result.resource.language).toBe("ca");
		expect(result.warnings.some((w) => w.field === "language")).toBe(false);
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
		expect(
			result.blockingErrors.some((e) => e.includes("descriptionStr")),
		).toBe(true);
	});

	it("flags a missing external id as blocking and falls back to the .elpx filename for the title", () => {
		const result = mapLegacyRecord(
			{
				descriptionStr: "d",
				rightsCopyrightAndOtherRestrictionsStr: "creative commons: attribution",
			},
			"nombre-del-archivo.elpx",
		);

		expect(result.blocking).toBe(true);
		expect(result.externalId).toBe("");
		expect(result.resource.title).toBe("nombre-del-archivo.elpx");
	});

	it("falls back to id when idODE is an empty string, not just null/undefined", () => {
		const result = mapLegacyRecord(
			{
				idODE: "",
				id: "es_fallback_id",
				descriptionStr: "d",
				rightsCopyrightAndOtherRestrictionsStr: "creative commons: attribution",
			},
			"fallback.elpx",
		);

		expect(result.blocking).toBe(false);
		expect(result.externalId).toBe("es_fallback_id");
	});

	it("resolveLegacyExternalId treats an empty idODE the same as a missing one", () => {
		expect(resolveLegacyExternalId({ idODE: "", id: "es_x" })).toBe("es_x");
		expect(resolveLegacyExternalId({ idODE: "es_y", id: "es_x" })).toBe("es_y");
		expect(resolveLegacyExternalId({})).toBe("");
	});

	it("falls back to technicalLocationStr when rutaAccesoContenidos is an empty string", () => {
		const result = mapLegacyRecord(
			{
				idODE: "es_test",
				descriptionStr: "d",
				rightsCopyrightAndOtherRestrictionsStr: "creative commons: attribution",
				rutaAccesoContenidos: "",
				technicalLocationStr: "https://ode.educacion.es/INTEF/es_test",
			},
			"fallback.elpx",
		);

		expect(result.resource.sourceUri).toBe(
			"https://ode.educacion.es/INTEF/es_test",
		);
	});

	it("truncates resourceType/subjects/levels/keywords that exceed the destination column limits, with warnings", () => {
		const longSubject = "M".repeat(300);
		const longLevel = "N".repeat(150);
		const longKeywords = Array.from({ length: 5 }, (_, i) =>
			`palabra-clave-larga-numero-${i}`.repeat(10),
		);

		const result = mapLegacyRecord(
			{
				idODE: "es_test_long",
				descriptionStr: "d",
				rightsCopyrightAndOtherRestrictionsStr: "creative commons: attribution",
				knowledgeArea: [longSubject],
				learningContext: [longLevel],
				labelsStr: longKeywords,
			},
			"fallback.elpx",
		);

		expect(result.blocking).toBe(false);
		expect(result.resource.subjects[0]?.length).toBeLessThanOrEqual(255);
		expect(result.resource.levels[0]?.length).toBeLessThanOrEqual(100);
		expect(result.resource.keywords?.length).toBeLessThanOrEqual(1000);
		expect(result.warnings.some((w) => w.field === "subjects")).toBe(true);
		expect(result.warnings.some((w) => w.field === "levels")).toBe(true);
		expect(result.warnings.some((w) => w.field === "keywords")).toBe(true);
	});

	it("does not warn about truncation when all values already fit the destination limits", () => {
		const result = mapLegacyRecord(
			{
				idODE: "es_test_short",
				descriptionStr: "d",
				rightsCopyrightAndOtherRestrictionsStr: "creative commons: attribution",
				knowledgeArea: ["Matemáticas"],
				learningContext: ["Bachillerato"],
				labelsStr: ["geometria", "areas"],
			},
			"fallback.elpx",
		);

		expect(result.warnings.some((w) => w.field === "subjects")).toBe(false);
		expect(result.warnings.some((w) => w.field === "levels")).toBe(false);
		expect(result.warnings.some((w) => w.field === "keywords")).toBe(false);
		expect(result.resource.keywords).toBe("geometria,areas");
	});

	describe("importedAt (regresión hallazgo P2, revisión #268: fechas de calendario imposibles no deben normalizarse en silencio)", () => {
		const base = {
			idODE: "es_test_date",
			descriptionStr: "d",
			rightsCopyrightAndOtherRestrictionsStr: "creative commons: attribution",
		};

		it("parsea fechaRegistro YYYYMMDD válida", () => {
			const result = mapLegacyRecord(
				{ ...base, fechaRegistro: "20230228" },
				"fallback.elpx",
			);
			expect(result.resource.importedAt?.toISOString()).toBe(
				"2023-02-28T00:00:00.000Z",
			);
		});

		it("rechaza fechaRegistro con un 31 de febrero en vez de normalizarlo al 3 de marzo", () => {
			// Date.UTC(2023, 1, 31) no lanza ni da NaN: desborda a 2023-03-03.
			const result = mapLegacyRecord(
				{ ...base, fechaRegistro: "20230231" },
				"fallback.elpx",
			);
			expect(result.resource.importedAt).toBeNull();
		});

		it("rechaza fechaRegistro con un mes fuera de rango (13)", () => {
			const result = mapLegacyRecord(
				{ ...base, fechaRegistro: "20231301" },
				"fallback.elpx",
			);
			expect(result.resource.importedAt).toBeNull();
		});

		it("rechaza el 29 de febrero en un año no bisiesto pero lo acepta en uno bisiesto", () => {
			const nonLeap = mapLegacyRecord(
				{ ...base, fechaRegistro: "20230229" },
				"fallback.elpx",
			);
			expect(nonLeap.resource.importedAt).toBeNull();

			const leap = mapLegacyRecord(
				{ ...base, fechaRegistro: "20240229" },
				"fallback.elpx",
			);
			expect(leap.resource.importedAt?.toISOString()).toBe(
				"2024-02-29T00:00:00.000Z",
			);
		});

		it("acepta un publicationDate ISO válido con hora completa", () => {
			const result = mapLegacyRecord(
				{ ...base, publicationDate: "2021-05-29T13:48:27.339Z" },
				"fallback.elpx",
			);
			expect(result.resource.importedAt?.toISOString()).toBe(
				"2021-05-29T13:48:27.339Z",
			);
		});

		it("rechaza un publicationDate ISO con un 31 de febrero y cae al fallback fechaRegistro", () => {
			// new Date("2023-02-31") tiene el mismo problema de normalización que
			// Date.UTC: desborda a 2023-03-03 en vez de fallar.
			const result = mapLegacyRecord(
				{
					...base,
					publicationDate: "2023-02-31T10:00:00.000Z",
					fechaRegistro: "20220101",
				},
				"fallback.elpx",
			);
			expect(result.resource.importedAt?.toISOString()).toBe(
				"2022-01-01T00:00:00.000Z",
			);
		});

		it("conserva la URL preview del JSON como imagen de la tarjeta (issue #407)", async () => {
			const json = await loadFixture("es_2024052212_9181312");
			const result = mapLegacyRecord(json, "fallback.elpx");

			expect(result.blocking).toBe(false);
			expect(result.resource.previewImageUrl).toBe(
				"https://ode.educacion.es/INTEF/es_2024052212_9181312/vistaPreviaAgrega.png",
			);
		});

		it("ignora un preview que no es http(s) y no bloquea la importación", async () => {
			const json = await loadFixture("es_2024052212_9181312");
			const result = mapLegacyRecord(
				{ ...json, preview: "javascript:alert(1)" },
				"fallback.elpx",
			);

			expect(result.blocking).toBe(false);
			expect(result.resource.previewImageUrl).toBeNull();
			expect(result.warnings.map((warning) => warning.field)).toContain(
				"preview",
			);
		});

		it("deja la miniatura vacía cuando el JSON no trae preview", async () => {
			const json = await loadFixture("es_2024052212_9181312");
			const { preview: _preview, ...withoutPreview } = json;
			const result = mapLegacyRecord(withoutPreview, "fallback.elpx");

			expect(result.resource.previewImageUrl).toBeNull();
			expect(result.warnings.map((warning) => warning.field)).not.toContain(
				"preview",
			);
		});

		it("devuelve importedAt null cuando no hay ninguna fecha de origen utilizable", () => {
			const result = mapLegacyRecord(
				{
					...base,
					publicationDate: "2023-02-31T10:00:00.000Z",
					fechaRegistro: "20231301",
				},
				"fallback.elpx",
			);
			expect(result.resource.importedAt).toBeNull();
		});
	});
});

describe("mapLegacyRecord — estado de publicación (issue #447)", () => {
	it("published = 1 se importa como publicado, sin aviso", async () => {
		const json = await loadFixture("es_2024052212_9181312");
		const result = mapLegacyRecord(json, "fallback.elpx");

		expect(result.resource.editorialStatus).toBe("published");
		expect(result.resource.sourcePublished).toBe(1);
		expect(result.warnings.map((w) => w.field)).not.toContain("published");
	});

	it("published = 0 se importa como borrador", async () => {
		const json = await loadFixture("es_2024052212_9181312");
		const result = mapLegacyRecord({ ...json, published: 0 }, "fallback.elpx");

		expect(result.blocking).toBe(false);
		expect(result.resource.editorialStatus).toBe("draft");
		expect(result.resource.sourcePublished).toBe(0);
		expect(result.warnings.map((w) => w.field)).not.toContain("published");
	});

	it("published ausente o desconocido se importa como borrador y se avisa", async () => {
		const json = await loadFixture("es_2024052212_9181312");
		const { published: _published, ...withoutPublished } = json;
		for (const record of [withoutPublished, { ...json, published: "x" }]) {
			const result = mapLegacyRecord(record, "fallback.elpx");
			expect(result.blocking).toBe(false);
			expect(result.resource.editorialStatus).toBe("draft");
			expect(
				result.warnings.find((w) => w.field === "published")?.message,
			).toContain("se importa como borrador");
		}
	});
});
