import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EmbedModal } from "./EmbedModal.tsx";

describe("EmbedModal", () => {
	test("no renderiza nada cuando no hay embed", () => {
		const html = renderToStaticMarkup(
			<EmbedModal embed={null} onClose={() => {}} />,
		);
		expect(html).toBe("");
	});

	test("renderiza un player de vídeo con sandbox de proveedor (sin tocar Procomún)", () => {
		const html = renderToStaticMarkup(
			<EmbedModal
				embed={{
					kind: "video",
					url: "https://www.youtube-nocookie.com/embed/abc123",
				}}
				onClose={() => {}}
			/>,
		);
		expect(html).toContain("https://www.youtube-nocookie.com/embed/abc123");
		// El player lleva sandbox con allow-same-origin (su PROPIO origen, aislado por SOP).
		expect(html).toContain("allow-same-origin");
		expect(html).toContain(
			'allow="autoplay; encrypted-media; fullscreen; picture-in-picture"',
		);
		expect(html).toContain("Vídeo");
	});

	test("renderiza un visor de PDF sin sandbox y sin referrer", () => {
		const html = renderToStaticMarkup(
			<EmbedModal
				embed={{ kind: "pdf", url: "https://example.com/doc.pdf" }}
				onClose={() => {}}
			/>,
		);
		expect(html).toContain("https://example.com/doc.pdf");
		expect(html).toContain("Documento PDF");
		// El visor de PDF no lleva sandbox.
		expect(html).not.toContain("sandbox");
	});
});
