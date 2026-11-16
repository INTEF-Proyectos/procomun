import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	AuthorSearchLinks,
	PublisherLink,
	ResourceByline,
} from "./AuthorLinks.tsx";

describe("AuthorLinks (#458)", () => {
	test("el nombre de quien publica es el enlace a su ficha", () => {
		const html = renderToStaticMarkup(
			<PublisherLink id="legacy:user:1" name="CEDEC INTEF" />,
		);
		expect(html).toBe(
			'<a class="author-link" href="/autor/legacy%3Auser%3A1">CEDEC INTEF</a>',
		);
	});

	test("cada autor del texto libre es un enlace de búsqueda, separados por comas", () => {
		const html = renderToStaticMarkup(
			<AuthorSearchLinks author="Ana López, Luis Gil… para Cedec" />,
		);
		expect(html).toContain(
			'<a class="author-link" href="/explorar?q=Ana%20L%C3%B3pez">Ana López</a>',
		);
		expect(html).toContain(
			'<a class="author-link" href="/explorar?q=Luis%20Gil">Luis Gil</a>',
		);
		expect(html.replace(/<[^>]+>/g, "")).toBe("Ana López, Luis Gil");
	});

	test("sin autor no pinta nada", () => {
		expect(renderToStaticMarkup(<AuthorSearchLinks author="" />)).toBe("");
	});

	test("en las tarjetas prima la cuenta que publica", () => {
		const html = renderToStaticMarkup(
			<ResourceByline
				resource={{ createdBy: "u1", createdByName: "Ana", author: "Otra" }}
			/>,
		);
		expect(html).toContain('href="/autor/u1"');
		expect(html).not.toContain("Otra");
	});

	test("los importados sin cuenta enlazan el autor a la búsqueda", () => {
		const html = renderToStaticMarkup(
			<ResourceByline
				resource={{ createdBy: null, createdByName: null, author: "Ana" }}
			/>,
		);
		expect(html).not.toContain("/autor/");
		expect(html).toContain('href="/explorar?q=Ana"');
	});

	test("sin cuenta ni autor muestra «Anónimo» como texto", () => {
		const html = renderToStaticMarkup(
			<ResourceByline resource={{ author: null }} />,
		);
		expect(html).toContain("Anónimo");
		expect(html).not.toContain("<a");
	});
});
