import { describe, expect, test } from "bun:test";
import { buildFeed } from "./service.ts";

describe("buildFeed", () => {
	const baseOpts = {
		title: "Test Feed",
		description: "A test feed",
		feedId: "http://localhost/feeds/atom/resources",
		feedUrl: "http://localhost/feeds/atom/resources",
		siteUrl: "http://localhost",
		baseUrl: "http://localhost",
		total: 2,
		limit: 20,
		offset: 0,
	};

	const sampleResources = [
		{
			id: "res-1",
			title: "Recurso de Matemáticas",
			slug: "recurso-de-matematicas",
			description: "Descripción del recurso",
			author: "María García",
			createdByName: null,
			createdAt: "2026-01-15T10:00:00Z",
			resourceType: "actividad-interactiva",
			language: "es",
			license: "cc-by",
			keywords: "matemáticas,primaria",
		},
		{
			id: "res-2",
			title: "Recurso de Ciencias",
			slug: "recurso-de-ciencias",
			description: "Ciencias naturales",
			author: null,
			createdByName: "Juan López",
			createdAt: "2026-01-14T08:00:00Z",
			resourceType: "documento",
			language: "es",
			license: "cc-by-sa",
			keywords: null,
		},
	];

	test("generates valid Atom 1.0 XML", () => {
		const feed = buildFeed({ ...baseOpts, resources: sampleResources });
		const atom = feed.atom1();

		expect(atom).toContain('<?xml version="1.0" encoding="utf-8"?>');
		expect(atom).toContain("<feed");
		expect(atom).toContain("http://www.w3.org/2005/Atom");
		expect(atom).toContain("<title>Test Feed</title>");
		expect(atom).toContain("Recurso de Matemáticas");
		expect(atom).toContain("Recurso de Ciencias");
		expect(atom).toContain("http://localhost/recursos/recurso-de-matematicas");
	});

	test("generates valid RSS 2.0 XML", () => {
		const feed = buildFeed({ ...baseOpts, resources: sampleResources });
		const rss = feed.rss2();

		expect(rss).toContain('<?xml version="1.0" encoding="utf-8"?>');
		expect(rss).toContain("<rss");
		expect(rss).toContain("<channel>");
		expect(rss).toContain("<title>Test Feed</title>");
		expect(rss).toContain("Recurso de Matemáticas");
		expect(rss).toContain("http://localhost/recursos/recurso-de-matematicas");
	});

	test("includes categories from resourceType and keywords", () => {
		const feed = buildFeed({ ...baseOpts, resources: sampleResources });
		const atom = feed.atom1();

		expect(atom).toContain("actividad-interactiva");
		expect(atom).toContain("matemáticas");
		expect(atom).toContain("primaria");
	});

	test("añade las palabras clave del catálogo sin repetir (ADR-0042)", () => {
		const feed = buildFeed({
			...baseOpts,
			resources: [
				{
					id: "res-3",
					title: "Recurso de Astronomía",
					slug: "recurso-de-astronomia",
					description: "Sistema solar",
					author: null,
					createdAt: "2026-01-13T08:00:00Z",
					resourceType: "documento",
					language: "es",
					license: "cc-by",
					keywords: "Astronomía, planetas",
					catalogLabels: "Astronomía,Física",
				},
			],
		});
		expect(feed.items[0]?.category?.map((c) => c.name)).toEqual([
			"documento",
			"Astronomía",
			"planetas",
			"Física",
		]);
	});

	test("uses createdByName as fallback author", () => {
		const feed = buildFeed({ ...baseOpts, resources: sampleResources });
		const atom = feed.atom1();

		expect(atom).toContain("María García");
		expect(atom).toContain("Juan López");
	});

	test("handles empty resource list", () => {
		const feed = buildFeed({ ...baseOpts, resources: [], total: 0 });
		const atom = feed.atom1();

		expect(atom).toContain("<title>Test Feed</title>");
		expect(atom).not.toContain("<entry>");
	});

	test("uses slug in resource URL when available", () => {
		const feed = buildFeed({ ...baseOpts, resources: sampleResources });
		const atom = feed.atom1();

		expect(atom).toContain("http://localhost/recursos/recurso-de-matematicas");
		expect(atom).toContain("http://localhost/recursos/recurso-de-ciencias");
	});

	test("falls back to id when slug is null", () => {
		const first = sampleResources[0];
		expect(first).toBeDefined();
		if (!first) throw new Error("missing sample resource");
		const resourceWithoutSlug = [{ ...first, slug: null }];
		const feed = buildFeed({
			...baseOpts,
			resources: resourceWithoutSlug,
			total: 1,
		});
		const atom = feed.atom1();

		expect(atom).toContain("http://localhost/recursos/res-1");
	});

	test("neutralizes all CDATA terminators to prevent breakout (issue #248)", () => {
		// Payload con DOS terminadores `]]>`: el segundo escapaba al saneo
		// de xml-js (String.replace solo cambia la primera aparición) y cerraba
		// la sección CDATA, inyectando `<img onerror>` como marcado vivo.
		const payload = "x]]>]]><img src=x onerror=alert(1)>";
		const first = sampleResources[0];
		expect(first).toBeDefined();
		if (!first) throw new Error("missing sample resource");
		const maliciousResources = [
			{
				...first,
				// Solo title/description de ítem van en CDATA (donde aplica el bug de xml-js).
				title: payload,
				description: payload,
			},
		];
		const feed = buildFeed({
			...baseOpts,
			// title/description de canal van como texto (_text), no CDATA.
			title: "Canal de prueba",
			description: "Descripción de prueba",
			resources: maliciousResources,
			total: 1,
		});

		for (const xml of [feed.atom1(), feed.rss2()]) {
			// No hay ruptura de CDATA: el terminador nunca queda justo antes del marcado.
			expect(xml.includes("]]><img")).toBe(false);
			// El payload de ítem queda inerte dentro de CDATA; tras eliminar las
			// secciones CDATA no debe quedar ningún `<img` como marcado vivo.
			const withoutCdata = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
			expect(withoutCdata.includes("<img")).toBe(false);
			// El terminador de los campos CDATA queda neutralizado.
			expect(xml).toContain("]]&gt;");
			// XML bien formado (al menos un cierre de feed/rss).
			expect(xml.includes("</feed>") || xml.includes("</rss>")).toBe(true);
		}
	});
});
