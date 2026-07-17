import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// DEF-015 (#209): el ancho del editor de colecciones ocultaba los botones de
// acción (Subir/Bajar/Quitar) del listado de recursos incrustado. Este test
// vigila las reglas CSS que garantizan su visibilidad.
const css = readFileSync(
	new URL("./AdminPageIsland.css", import.meta.url),
	"utf8",
);
const compact = css.replace(/[\t ]+/g, " ");

describe("Editor de colecciones — visibilidad de acciones (DEF-015)", () => {
	test("el diálogo de edición se ensancha respecto al diálogo de confirmación base", () => {
		// El editor incrusta una sub-tabla de recursos y necesita más ancho que los
		// 520px del diálogo de confirmación para no ocultar las acciones del listado.
		expect(compact).toContain("min(880px");
		const widened = /\.admin-edit-dialog\s*\{[^}]*max-width:\s*min\(880px/.test(
			compact,
		);
		expect(widened).toBe(true);
	});

	test("las acciones del listado de recursos envuelven en lugar de desbordar", () => {
		const rule = compact.match(
			/\.collection-resource-section\s+\.admin-actions-cell\s*\{([^}]*)\}/,
		);
		expect(rule).not.toBeNull();
		expect(rule?.[1] ?? "").toContain("flex-wrap: wrap");
	});
});
