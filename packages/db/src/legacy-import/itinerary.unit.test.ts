import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
	cleanLegacyItineraryDescription,
	LEGACY_ITINERARY_DISCARDED_FIELDS,
	type LegacyItineraryJson,
	mapLegacyItinerary,
	resolveLegacyItineraryId,
} from "./itinerary.ts";

// JSON real del exportador de itinerarios (#432), con el nombre y el correo
// de quien publica sustituidos por datos ficticios.
const FIXTURE = path.join(
	import.meta.dir,
	"../../../../apps/cli/src/test-fixtures/legacy-itineraries/itinerarios.json",
);

async function loadFixture(): Promise<LegacyItineraryJson[]> {
	return (await Bun.file(FIXTURE).json()) as LegacyItineraryJson[];
}

describe("mapLegacyItinerary (#432)", () => {
	test("itinerario 1: un ODE y un artículo, en ese orden, y publicado", async () => {
		const [first] = await loadFixture();
		const result = mapLegacyItinerary(first as LegacyItineraryJson);

		expect(result.blockingErrors).toEqual([]);
		const mapped = result.mapped;
		expect(mapped?.externalId).toBe("5FCZLpYBAcddN1-Hc4ZU");
		expect(mapped?.importSource).toBe("legacy-procomun");
		expect(mapped?.title).toBe(
			"Identificación de herramientas/equipos del taller",
		);
		expect(mapped?.editorialStatus).toBe("published");
		expect(mapped?.publishedAt?.toISOString()).toBe("2025-04-13T12:02:58.000Z");
		expect(mapped?.isOrdered).toBe(true);
		expect(mapped?.slugBase).toBe(
			"identificacion-de-herramientas-equipos-del-taller",
		);
		expect(mapped?.publicatorEmail).toBe("docente.itinerario.uno@ejemplo.test");
		expect(mapped?.resources).toEqual([
			{ externalId: "es_2025041312_9101210", kind: "ode" },
			{ externalId: "eVC1LpYBAcddN1-HHKC-", kind: "article" },
		]);
	});

	test("itinerario 2: conserva el orden de los cinco ODE del JSON y normaliza el correo", async () => {
		const [, second] = await loadFixture();
		const mapped = mapLegacyItinerary(second as LegacyItineraryJson).mapped;

		expect(mapped?.resources.map((r) => r.externalId)).toEqual([
			"es_2026073112_9085355",
			"es_2026073112_9085905",
			"es_2026073112_9132300",
			"es_2026073112_9134804",
			"es_2026073112_9091303",
		]);
		expect(mapped?.resources.every((r) => r.kind === "ode")).toBe(true);
		expect(mapped?.publicatorEmail).toBe("docente.itinerario.dos@ejemplo.test");
	});

	test("descarta knowledgeArea, labelsStr, learningContext y educationalDescription con aviso", async () => {
		const [first] = await loadFixture();
		const result = mapLegacyItinerary(first as LegacyItineraryJson);

		expect(LEGACY_ITINERARY_DISCARDED_FIELDS).toEqual([
			"knowledgeArea",
			"labelsStr",
			"learningContext",
			"educationalDescription",
		]);
		// educationalDescription llega como ["", ""]: vacío, no se avisa.
		expect(result.mapped?.discardedFields).toEqual([
			"knowledgeArea",
			"labelsStr",
			"learningContext",
		]);
	});

	test("published 0 (o ausente) entra como borrador", () => {
		const base = {
			id: "it-borrador",
			titleStr: "Borrador",
			descriptionStr: "Algo",
		};
		expect(
			mapLegacyItinerary({ ...base, published: 0 }).mapped?.editorialStatus,
		).toBe("draft");
		expect(mapLegacyItinerary(base).mapped?.editorialStatus).toBe("draft");
		expect(
			mapLegacyItinerary({ ...base, published: "1" }).mapped?.editorialStatus,
		).toBe("published");
	});

	test("no repite un recurso que aparece en los dos bloques", () => {
		const mapped = mapLegacyItinerary({
			id: "it-dup",
			titleStr: "Duplicado",
			descriptionStr: "Algo",
			itineraryContent: { es_1: "a", es_2: "b" },
			interestContent: { es_1: "a otra vez", art_1: "c" },
		}).mapped;
		expect(mapped?.resources).toEqual([
			{ externalId: "es_1", kind: "ode" },
			{ externalId: "es_2", kind: "ode" },
			{ externalId: "art_1", kind: "article" },
		]);
	});

	test("sin id o sin título no se puede importar", () => {
		expect(
			mapLegacyItinerary({ titleStr: "Sin id", descriptionStr: "x" })
				.blockingErrors,
		).toEqual([
			"Falta id: no se puede identificar ni deduplicar el itinerario",
		]);
		expect(
			mapLegacyItinerary({ id: "it-1", titleStr: "  ", descriptionStr: "x" })
				.blockingErrors,
		).toEqual(["Falta titleStr"]);
	});

	test("sin descripción usa el título, con aviso", () => {
		const result = mapLegacyItinerary({ id: "it-2", titleStr: "Solo título" });
		expect(result.mapped?.description).toBe("Solo título");
		expect(result.mapped?.warnings).toContain(
			"descriptionStr vacío: se usa el título como descripción",
		);
	});

	test("trunca título y descripción a los límites de validateCollection", () => {
		const mapped = mapLegacyItinerary({
			id: "it-largo",
			titleStr: "t".repeat(600),
			descriptionStr: "d".repeat(6000),
		}).mapped;
		expect(mapped?.title).toHaveLength(500);
		expect(mapped?.description).toHaveLength(5000);
		expect(mapped?.warnings).toHaveLength(2);
	});

	test("una fecha de publicación no válida se ignora con aviso", () => {
		const mapped = mapLegacyItinerary({
			id: "it-fecha",
			titleStr: "Fecha",
			descriptionStr: "x",
			publicationDate: "no es una fecha",
		}).mapped;
		expect(mapped?.publishedAt).toBeNull();
		expect(mapped?.warnings).toContain(
			'publicationDate no válida ("no es una fecha"): se ignora',
		);
	});
});

describe("cleanLegacyItineraryDescription", () => {
	test("quita \\r\\n, tabuladores y espacios duros del itinerario 1 real", async () => {
		const [first] = await loadFixture();
		expect(cleanLegacyItineraryDescription(first?.descriptionStr)).toBe(
			'Juego interactivo "Selecciona(multimedia)" de la plataforma eXeLearning para completar y ampliar, con objeto de identificar las herramientas y equipos de un taller de mecanizado básico, para hacer operaciones básicas de fabricación. El juego ya está creado para 4 herramientas. Se trataría de ampliarlo hasta los 16 elementos obteniendo las imágenes libres de páginas como Pixabay\n\nArtículo con las instrucciones\nRecurso con los archivos',
		);
	});

	test("el itinerario 2 no tiene saltos: solo cambia los espacios duros", async () => {
		const [, second] = await loadFixture();
		const cleaned = cleanLegacyItineraryDescription(second?.descriptionStr);
		expect(cleaned).not.toContain(" ");
		expect(cleaned).toContain("lecheras. -Presentación");
	});

	test("quita etiquetas HTML y decodifica las entidades habituales", () => {
		expect(
			cleanLegacyItineraryDescription(
				"<p>Uno &amp; dos</p><ul><li>tres&nbsp;&lt;4&gt;</li></ul><br/>cinco",
			),
			// Como mucho una línea en blanco seguida, venga del HTML o del texto.
		).toBe("Uno & dos\ntres <4>\n\ncinco");
	});

	test("no devuelve nada con valores vacíos o que no son texto", () => {
		expect(cleanLegacyItineraryDescription(undefined)).toBe("");
		expect(cleanLegacyItineraryDescription(null)).toBe("");
		expect(cleanLegacyItineraryDescription(" \r\n\t ")).toBe("");
	});
});

describe("resolveLegacyItineraryId", () => {
	test("usa id y lo recorta; sin id devuelve vacío", () => {
		expect(resolveLegacyItineraryId({ id: " abc " })).toBe("abc");
		expect(resolveLegacyItineraryId({})).toBe("");
		expect(resolveLegacyItineraryId(null)).toBe("");
	});
});
