import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { RelatedResourcesResult, Resource } from "../../lib/api-client.ts";
import { url } from "../../lib/paths.ts";
import { ResourceCard } from "../../ui/ResourceCard.tsx";
import { CatalogIsland, CatalogResourceCard } from "./CatalogIsland.tsx";
import { CatalogSearchIsland } from "./CatalogSearchIsland.tsx";
import {
	ResourceDetailContent,
	ResourceDetailIsland,
	updateStatsAfterDownload,
} from "./ResourceDetailIsland.tsx";

function renderDetail(
	resource: Partial<Resource>,
	role: string,
	related: RelatedResourcesResult | null = null,
	stats: Parameters<typeof ResourceDetailContent>[0]["stats"] = null,
): string {
	return renderToStaticMarkup(
		<ResourceDetailContent
			resource={{
				id: "res-1",
				slug: "recurso",
				title: "Recurso",
				description: "",
				language: "es",
				license: "cc-by",
				resourceType: "document",
				keywords: null,
				author: null,
				publisher: null,
				editorialStatus: "published",
				createdBy: "author-1",
				createdByName: "Autora",
				createdAt: null,
				updatedAt: null,
				deletedAt: null,
				...resource,
			}}
			session={{
				user: { id: "curator-1", email: "c@example.org", name: "C", role },
			}}
			stats={stats}
			isFavorited={false}
			related={related}
		/>,
	);
}

describe("Catalog islands", () => {
	test("CatalogSearchIsland renderiza el buscador de cabecera", () => {
		const html = renderToStaticMarkup(
			<CatalogSearchIsland initialQuery="matematicas" />,
		);

		expect(html).toContain("Buscar recursos...");
		expect(html).toContain("matematicas");
		expect(html).toContain("Limpiar búsqueda");
	});

	test("CatalogSearchIsland oculta el limpiador si no hay término", () => {
		const html = renderToStaticMarkup(<CatalogSearchIsland initialQuery="" />);

		expect(html).not.toContain("Limpiar búsqueda");
	});

	test("la tarjeta muestra la imagen de metadatos y no el iframe del paquete", () => {
		const html = renderToStaticMarkup(
			<CatalogResourceCard
				resource={{
					id: "r1",
					slug: "inventar-problemas",
					title: "Inventar problemas",
					description: "Una frase inicial",
					language: "es",
					license: "cc-by-nc-sa",
					resourceType: "proyecto",
					keywords: null,
					author: "Autor",
					publisher: null,
					editorialStatus: "published",
					createdBy: null,
					createdByName: null,
					createdAt: null,
					updatedAt: null,
					deletedAt: null,
					thumbnailUrl:
						"https://ode.educacion.es/INTEF/1416349635379/vistaPreviaAgrega.png",
					elpxPreview: { hash: "abc", previewUrl: "/api/v1/elpx/abc/" },
				}}
			/>,
		);

		expect(html).toContain("vistaPreviaAgrega.png");
		expect(html).not.toContain("/api/v1/elpx/abc/");
		expect(html).not.toContain("<iframe");
	});

	test("CatalogIsland renderiza el shell inicial del catalogo", () => {
		const html = renderToStaticMarkup(<CatalogIsland />);

		expect(html).toContain("Filtros");
		expect(html).toContain("Cargando recursos...");
		expect(html).toContain("Limpiar filtros");
		expect(html).toContain("chevron_right");
	});

	test("las tarjetas de recomendados muestran la previsualización del recurso (#426)", () => {
		const card = {
			id: "rel-1",
			slug: "relacionado",
			title: "Relacionado",
			description: "",
			resourceType: "proyecto",
			language: "es",
			license: "cc-by",
			author: null,
			score: 1,
			elpxPreview: { hash: "abc", previewUrl: "/api/v1/elpx/abc/" },
		};
		const html = renderDetail({}, "reader", {
			data: [card],
			sameAuthor: [],
			limit: 6,
		});

		expect(html).toContain('src="/api/v1/elpx/abc/"');
	});

	test("sin cuenta, la ficha pone el publicador bajo el título y los autores debajo (#457)", () => {
		const html = renderDetail(
			{
				createdBy: null,
				createdByName: null,
				author: "Mª del Mar Pérez Gómez para Cedec",
				publisher: "CEDEC INTEF",
			},
			"reader",
		);

		// Con #458 cada autor es un enlace de búsqueda (sin la coletilla «para
		// X»); el publicador, sin cuenta a la que enlazar, queda como texto.
		const q = encodeURIComponent("Mª del Mar Pérez Gómez");
		expect(html).toContain(
			`<p class="detail-author-name">CEDEC INTEF</p><p class="detail-author-role"><span><a class="author-link" href="${url(`explorar?q=${q}`)}">Mª del Mar Pérez Gómez</a></span></p>`,
		);
		expect(html).not.toContain(url("autor/"));
	});

	test("sin cuenta ni publicador, la ficha sigue mostrando los autores (#457)", () => {
		const html = renderDetail(
			{ createdBy: null, createdByName: null, author: "Ana Pérez" },
			"reader",
		);

		expect(html).toContain(
			`<p class="detail-author-name"><span><a class="author-link" href="${url(`explorar?q=${encodeURIComponent("Ana Pérez")}`)}">Ana Pérez</a></span></p>`,
		);
		expect(html).not.toContain("detail-author-role");
	});

	test("con cuenta, la ficha mantiene la cuenta arriba y el publicador debajo (#457)", () => {
		const html = renderDetail(
			{ author: "Ana Pérez", publisher: "CEDEC INTEF" },
			"reader",
		);

		// Con #458 la cuenta enlaza a su ficha y la autoría va entre ambas.
		expect(html).toContain(
			`<p class="detail-author-name"><a class="author-link" href="${url("autor/author-1")}">Autora</a></p><p class="detail-author-role">Autoría: <span><a class="author-link" href="${url(`explorar?q=${encodeURIComponent("Ana Pérez")}`)}">Ana Pérez</a></span></p><p class="detail-author-role">CEDEC INTEF</p>`,
		);
	});

	test("la ficha no muestra los niveles en texto libre del Procomún antiguo (#380)", () => {
		const html = renderDetail(
			{ levels: ["12 - 13 años / Primer curso"] },
			"reader",
		);

		expect(html).not.toContain("Niveles educativos");
		expect(html).not.toContain("12 - 13 años / Primer curso");
	});

	test("Detalles técnicos muestra «Otros autores» solo si tiene contenido (#417)", () => {
		const html = renderDetail(
			{ otherAuthors: "Luis Gómez, Marta Ruiz" },
			"reader",
		);
		expect(html).toContain("Otros autores");
		expect(html).toContain("Luis Gómez, Marta Ruiz");

		for (const otherAuthors of [null, undefined, "", "   "]) {
			expect(renderDetail({ otherAuthors }, "reader")).not.toContain(
				"Otros autores",
			);
		}
	});

	test("ResourceDetailIsland renderiza el estado de carga inicial", () => {
		const html = renderToStaticMarkup(<ResourceDetailIsland />);

		expect(html).toContain("Cargando recurso...");
	});

	test("ResourceDetailIsland actualiza el contador del formato exportado", () => {
		const stats = {
			downloadCount: 4,
			exportCounts: { scorm: 1, ims: 0, web: 2, epub: 0 },
			favoriteCount: 0,
			ratingAvg: 0,
			ratingCount: 0,
		};

		expect(updateStatsAfterDownload(stats, 5, "scorm")).toEqual({
			...stats,
			downloadCount: 5,
			exportCounts: { scorm: 2, ims: 0, web: 2, epub: 0 },
		});
	});

	test("ResourceDetailIsland no modifica contadores de exportacion en descarga directa", () => {
		const stats = {
			downloadCount: 4,
			exportCounts: { scorm: 1, ims: 0, web: 2, epub: 0 },
			favoriteCount: 0,
			ratingAvg: 0,
			ratingCount: 0,
		};

		expect(updateStatsAfterDownload(stats, 5, "direct")).toEqual({
			...stats,
			downloadCount: 5,
		});
	});

	// #399: «Editar» solo si la API lo permite (canManageResource); antes cualquier
	// curator lo veía y el editor respondía «Recurso no encontrado» por el 403.
	test("la ficha muestra la imagen de la licencia Creative Commons (#404)", () => {
		const html = renderDetail({ license: "cc-by-sa" }, "reader");

		expect(html).toContain("licenses/cc-by-sa.png");
		expect(html).toContain("https://creativecommons.org/licenses/by-sa/4.0/");
		expect(html).toContain('rel="license noopener noreferrer"');
		expect(html).toContain(
			"Licencia Creative Commons Reconocimiento-CompartirIgual 4.0",
		);
		expect(html).not.toContain(">copyright<");
	});

	test("la valoración solo aparece en la ficha de un recurso publicado (#461)", () => {
		expect(renderDetail({}, "reader")).toContain("detail-ratings-section");
		for (const editorialStatus of ["draft", "review", "archived"]) {
			expect(renderDetail({ editorialStatus }, "admin")).not.toContain(
				"detail-ratings-section",
			);
		}
	});

	test("la ficha muestra las visitas junto a la valoración solo si está publicada (#421)", () => {
		const stats = {
			downloadCount: 0,
			favoriteCount: 0,
			ratingAvg: 0,
			ratingCount: 0,
			viewCount: 1234,
		};
		const html = renderDetail({}, "reader", null, stats);
		const ratings = html.slice(html.indexOf("detail-ratings-section"));
		expect(ratings).toContain("detail-views");
		expect(ratings).toContain("1234 visitas");

		expect(
			renderDetail({ editorialStatus: "draft" }, "admin", null, stats),
		).not.toContain("detail-views");
		// Sin estadísticas aún no se pinta un 0 provisional.
		expect(renderDetail({}, "reader")).not.toContain("detail-views");
	});

	test("«Ponlo en tu web» solo aparece en un recurso publicado (#466)", () => {
		const elpxPreview = { hash: "abc", previewUrl: "/api/v1/elpx/abc/" };
		expect(renderDetail({ elpxPreview }, "reader")).toContain("embed-section");
		for (const editorialStatus of ["draft", "review"]) {
			const html = renderDetail(
				{
					editorialStatus,
					elpxPreview: {
						hash: "abc",
						previewUrl: "/api/v1/elpx/preview/abc/123.firma/",
					},
				},
				"admin",
			);
			expect(html).not.toContain("embed-section");
			// La vista previa sigue disponible para quien tiene acceso.
			expect(html).toContain("/api/v1/elpx/preview/abc/123.firma/");
		}
	});

	test("la tarjeta de un recurso no publicado no muestra su valoración (#461)", () => {
		const card = (editorialStatus: string) =>
			renderToStaticMarkup(
				<ResourceCard
					resource={{
						id: "r1",
						slug: "r1",
						title: "Recurso",
						description: "",
						resourceType: "proyecto",
						language: "es",
						license: "cc-by",
						rating: { average: 4.5, count: 2 },
						editorialStatus,
						createdAt: "2026-10-01T00:00:00.000Z",
					}}
					href="/recurso?slug=r1"
				/>,
			);

		expect(card("published")).toContain("rc-stat-star");
		expect(card("draft")).not.toContain("rc-stat-star");
		expect(card("review")).not.toContain("4.5");
	});

	test("una licencia sin imagen oficial sigue viéndose como texto (#404)", () => {
		const html = renderDetail({ license: "mit-custom" }, "reader");

		expect(html).toContain("mit-custom");
		expect(html).not.toContain("licenses/");
	});

	test("ResourceDetailIsland muestra Editar al curator solo si puede gestionarlo", () => {
		const editHref = `href="${url("editar?id=res-1")}"`;
		expect(renderDetail({}, "curator")).not.toContain("Editar recurso");
		expect(renderDetail({ editorialStatus: "review" }, "curator")).toContain(
			"Editar recurso",
		);
		expect(
			renderDetail(
				{ editorialStatus: "draft", createdBy: "curator-1" },
				"curator",
			),
		).toContain(editHref);
		expect(
			renderDetail({ assignedCuratorId: "curator-1" }, "curator"),
		).toContain(editHref);
		expect(
			renderDetail({ assignedCuratorId: "curator-2" }, "curator"),
		).not.toContain("Editar recurso");
		expect(renderDetail({}, "admin")).toContain("Editar recurso");
	});

	// #459: los valores de los detalles técnicos llevan a una búsqueda.
	const search = (q: string) =>
		`href="${url(`explorar?q=${encodeURIComponent(q)}`)}"`;

	test("tipo e idioma muestran la denominación y buscan por ella", () => {
		const html = renderDetail(
			{ resourceType: "proyecto", language: "es" },
			"viewer",
		);
		expect(html).toContain(`${search("Proyecto")}>Proyecto</a>`);
		expect(html).toContain(`${search("Español")}>Español</a>`);
		expect(html).not.toContain(">proyecto<");
		expect(html).not.toContain(">es<");
	});

	test("cada materia y cada palabra libre buscan su valor completo", () => {
		const html = renderDetail(
			{
				subjects: ["Matemáticas", "Lengua Castellana"],
				keywords: "geometría, cálculo mental",
			},
			"viewer",
		);
		expect(html).toContain(`${search("Matemáticas")}>Matemáticas</a>`);
		expect(html).toContain(
			`${search("Lengua Castellana")}>Lengua Castellana</a>`,
		);
		expect(html).toContain(`${search("cálculo mental")}`);
	});

	test("las etiquetas del catálogo mantienen el filtro exacto", () => {
		const html = renderDetail(
			{
				catalogKeywords: [{ id: "k1", slug: "geometria", label: "Geometría" }],
			},
			"viewer",
		);
		expect(html).toContain(`href="${url("explorar?tag=geometria")}"`);
		expect(html).not.toContain(search("Geometría"));
	});

	test("la categorización educativa busca la categoría y cada opción", () => {
		const html = renderDetail(
			{
				educationalAreas: [
					{ categoryId: "educacion-infantil", optionId: "primer-ciclo" },
				],
			},
			"viewer",
		);
		expect(html).toContain(
			`${search("Educación Infantil")}>Educación Infantil</a>`,
		);
		expect(html).toContain(
			`${search("Primer ciclo (0-3 años)")}>Primer ciclo (0-3 años)</a>`,
		);
	});

	test("la fecha de publicación sigue siendo texto", () => {
		const html = renderDetail({ createdAt: "2024-05-01T00:00:00Z" }, "viewer");
		expect(html).not.toContain("explorar?q=2024");
		expect(html).toMatch(/<p class="meta-row-value">[^<]*2024<\/p>/);
	});
});

describe("nombres de autor pulsables (#458)", () => {
	const profileHref = `href="${url("autor/author-1")}"`;
	const searchHref = (name: string) =>
		`href="${url(`explorar?q=${encodeURIComponent(name)}`)}"`;

	test("en la ficha, quien publica lleva a su ficha y cada autor a su búsqueda", () => {
		const html = renderDetail(
			{ author: "Mª del Mar Pérez, Irene González… para Cedec" },
			"reader",
		);
		expect(html).toContain(`<a class="author-link" ${profileHref}>Autora</a>`);
		expect(html).toContain(searchHref("Mª del Mar Pérez"));
		expect(html).toContain(searchHref("Irene González"));
		expect(html).not.toContain("para Cedec");
	});

	test("en la ficha de un importado sin cuenta no hay enlace de publicador", () => {
		const html = renderDetail(
			{ createdBy: null, createdByName: null, author: "Ana López" },
			"reader",
		);
		expect(html).not.toContain(url("autor/"));
		expect(html).toContain(searchHref("Ana López"));
	});

	const resource = {
		id: "r1",
		slug: "r1",
		title: "Recurso",
		description: "",
		resourceType: "proyecto",
		language: "es",
		license: "cc-by",
		editorialStatus: "published",
		createdBy: "author-1",
		createdByName: "Autora",
		author: null,
	};

	test("la tarjeta común enlaza el nombre sin anidar enlaces", () => {
		const html = renderToStaticMarkup(
			<ResourceCard
				resource={{ ...resource, createdAt: "" }}
				href="/recurso?slug=r1"
			/>,
		);
		expect(html).toContain(profileHref);
		expect(html).toContain(
			'class="card-stretched-link" href="/recurso?slug=r1"',
		);
		expect(html.startsWith("<article")).toBe(true);
	});

	test("la tarjeta del catálogo enlaza el nombre sin anidar enlaces", () => {
		const html = renderToStaticMarkup(
			<CatalogResourceCard
				resource={{
					...resource,
					keywords: null,
					publisher: null,
					createdAt: null,
					updatedAt: null,
					deletedAt: null,
				}}
			/>,
		);
		expect(html).toContain(profileHref);
		expect(html).toContain("card-stretched-link");
		expect(html.startsWith("<article")).toBe(true);
	});
});
