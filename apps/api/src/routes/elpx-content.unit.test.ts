import { describe, expect, test } from "bun:test";
import {
	CONTENT_ASSET_CSP,
	CONTENT_HTML_CSP,
	readEmbedShimForTest,
} from "./elpx-content.ts";

describe("elpx-content CSP (audit H-1)", () => {
	test("HTML CSP keeps the content sandboxed without a same-origin escape", () => {
		expect(CONTENT_HTML_CSP).toContain(
			"sandbox allow-scripts allow-popups allow-forms",
		);
		// The escape token would let an author popup run at the platform origin.
		expect(CONTENT_HTML_CSP).not.toContain("allow-popups-to-escape-sandbox");
		expect(CONTENT_HTML_CSP).not.toContain("allow-same-origin");
	});

	test("non-HTML assets are served with an opaque-origin sandbox", () => {
		const directives = CONTENT_ASSET_CSP.split(";").map((d) => d.trim());
		// A top-level-navigated SVG/XML stays opaque -> its inline script cannot reach the platform.
		expect(directives).toContain("sandbox");
		expect(CONTENT_ASSET_CSP).not.toContain("allow-same-origin");
		expect(CONTENT_ASSET_CSP).not.toContain("allow-scripts");
	});
});

/**
 * El script que el API inyecta en cada HTML del .elpx es el LADO HIJO del bridge
 * compartido de eXeLearning, no una copia bespoke.
 *
 * Sin esto, el paquete se sirve con un runtime que no hace el handshake: el host
 * (que sí está migrado) nunca recibe `hello`, no promociona ningún embed y el
 * alumno ve recuadros negros permanentes donde debería haber vídeo. Es un fallo
 * silencioso — la página carga, no hay error en consola y no se reproduce nada —
 * así que la única forma de detectarlo es afirmar QUÉ bytes se sirven.
 */
describe("embed shim = artefacto canónico vendorizado", () => {
	test("los bytes servidos son los del child bundle vendorizado", async () => {
		const [served, vendored] = await Promise.all([
			readEmbedShimForTest(),
			Bun.file(
				new URL(
					"../../static/elpx/exe_external_media/exe-external-media-child.min.js",
					import.meta.url,
				),
			).text(),
		]);

		expect(served).toBe(vendored);
	});

	test("el script publica el contrato del bridge compartido", async () => {
		const served = await readEmbedShimForTest();

		// Los tres símbolos que el host y el iDevice de vídeo interactivo esperan.
		expect(served).toContain("exeExternalMediaChild");
		expect(served).toContain("exeEmbedShim");
		expect(served).toContain("exeMediaBridge");
		// Y la nota legal que ADR-0018 exige que sobreviva al minificado.
		expect(served).toContain("Dual-licensed");
	});
});
