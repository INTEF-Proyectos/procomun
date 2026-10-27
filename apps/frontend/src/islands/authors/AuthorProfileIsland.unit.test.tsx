import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { Resource } from "../../lib/api-client.ts";
import {
	AuthorNotFound,
	AuthorProfileContent,
	AuthorProfileIsland,
} from "./AuthorProfileIsland.tsx";

function resource(n: number): Resource {
	return {
		id: `r${n}`,
		slug: `recurso-${n}`,
		title: `Recurso ${n}`,
		description: "",
		language: "es",
		license: "cc-by",
		resourceType: "proyecto",
		keywords: null,
		author: null,
		publisher: null,
		editorialStatus: "published",
		createdBy: "u1",
		createdByName: "Ana Publicadora",
		createdAt: null,
		updatedAt: null,
		deletedAt: null,
	};
}

describe("AuthorProfileIsland (#458)", () => {
	test("muestra nombre, contador total y listado, sin correo", () => {
		const html = renderToStaticMarkup(
			<AuthorProfileContent
				author={{ id: "u1", name: "Ana Publicadora", image: null }}
				resources={[resource(1), resource(2)]}
				total={30}
				page={1}
				pageSize={12}
				onPageChange={() => {}}
			/>,
		);
		expect(html).toContain("<h1");
		expect(html).toContain("Ana Publicadora");
		expect(html).toContain("Recursos publicados");
		expect(html).toContain(">30<");
		expect(html).toContain("Recurso 1");
		expect(html).toContain("Recurso 2");
		expect(html).toContain('aria-label="Paginación"');
		expect(html).not.toContain("@");
	});

	test("la foto es opcional: con imagen se muestra, sin ella la inicial", () => {
		const withImage = renderToStaticMarkup(
			<AuthorProfileContent
				author={{ id: "u1", name: "Ana", image: "https://x.test/a.png" }}
				resources={[]}
				total={0}
				page={1}
				pageSize={12}
				onPageChange={() => {}}
			/>,
		);
		expect(withImage).toContain('src="https://x.test/a.png"');
		const withoutImage = renderToStaticMarkup(
			<AuthorProfileContent
				author={{ id: "u1", name: "Ana", image: null }}
				resources={[]}
				total={0}
				page={1}
				pageSize={12}
				onPageChange={() => {}}
			/>,
		);
		expect(withoutImage).not.toContain("<img");
		expect(withoutImage).toContain(">A<");
	});

	test("sin publicados el contador muestra cero y un aviso", () => {
		const html = renderToStaticMarkup(
			<AuthorProfileContent
				author={{ id: "u1", name: "Ana", image: null }}
				resources={[]}
				total={0}
				page={1}
				pageSize={12}
				onPageChange={() => {}}
			/>,
		);
		expect(html).toContain(">0<");
		expect(html).toContain("Todavía no ha publicado ningún recurso.");
		expect(html).not.toContain('aria-label="Paginación"');
	});

	test("ficha inexistente", () => {
		const html = renderToStaticMarkup(<AuthorNotFound />);
		expect(html).toContain("Ficha no encontrada");
	});

	test("monta con la ruta /autor/:id mostrando la carga", () => {
		const html = renderToStaticMarkup(
			<MemoryRouter initialEntries={["/autor/u1"]}>
				<Routes>
					<Route path="/autor/:id" element={<AuthorProfileIsland />} />
				</Routes>
			</MemoryRouter>,
		);
		expect(html).toContain("author-page");
	});
});
