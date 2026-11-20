import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PublicLayout } from "../layouts/PublicLayout.tsx";
import { MediaBankLinkView } from "./MediaBankLink.tsx";

describe("enlace al banco multimedia (#569)", () => {
	test("sin URL configurada no se pinta nada", () => {
		expect(renderToStaticMarkup(<MediaBankLinkView href={null} />)).toBe("");
	});

	test("con URL es un enlace normal, con texto y en la misma pestaña", () => {
		const html = renderToStaticMarkup(
			<MediaBankLinkView
				href="https://multimedia.example.es/"
				className="public-nav-link"
			/>,
		);
		expect(html).toContain('href="https://multimedia.example.es/"');
		expect(html).toContain('class="public-nav-link"');
		expect(html).toContain(">Banco multimedia<");
		expect(html).not.toContain("target=");
	});

	test("admite otro texto para /nuevo", () => {
		const html = renderToStaticMarkup(
			<MediaBankLinkView href="https://multimedia.example.es/" label="Ir" />,
		);
		expect(html).toContain(">Ir<");
	});

	test("la cabecera no muestra el enlace mientras no hay URL", () => {
		const html = renderToStaticMarkup(
			<MemoryRouter initialEntries={["/explorar"]}>
				<Routes>
					<Route path="*" element={<PublicLayout />} />
				</Routes>
			</MemoryRouter>,
		);
		expect(html).toContain("Explorar");
		expect(html).not.toContain("Banco multimedia");
	});
});
