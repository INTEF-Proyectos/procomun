import { describe, expect, test } from "bun:test";

const src = await Bun.file(
	new URL("./EditarPageBase.tsx", import.meta.url).pathname,
).text();

describe("EditarPageBase — subidor de archivos (#647)", () => {
	test("no busca el panel en el DOM desde un setTimeout tras setState", () => {
		// En el build de producción el temporizador salta antes de que React
		// monte el panel: getElementById devuelve null y el subidor no arranca.
		expect(src).not.toContain('getElementById("edit-multiupload-panel")');
	});

	test("inicializa el subidor con un ref al panel desde un efecto", () => {
		expect(src).toContain("ref={uploadPanelRef}");
		expect(src).toMatch(
			/useEffect\(\(\) => \{\s*const panel = uploadPanelRef\.current;/,
		);
	});

	test("recarga el recurso al pasar de nuevo a editar (isNew en las dependencias)", () => {
		// Al crear, la URL pierde `&new=1`; sin recargar no aparece la vista
		// previa del paquete recién generado.
		expect(src).toContain("}, [resourceId, isNew]);");
	});
});
