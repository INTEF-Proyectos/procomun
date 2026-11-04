import { describe, expect, test } from "bun:test";
import { roleLabel } from "./role-label.ts";

/**
 * #534: la insignia de rol del perfil pintaba `user.role` en crudo, así que se
 * veía la clave sin traducir («AUTHOR», en mayúsculas por el CSS de la
 * insignia). Las etiquetas salen de Paraglide, como el resto de la interfaz
 * pública.
 */
describe("roleLabel (#534)", () => {
	test("traduce los cinco roles con las etiquetas de la administración", () => {
		// Las mismas que ROLE_OPTIONS de AdminUsersSection, para que el perfil y
		// la administración no llamen distinto al mismo rol.
		expect(roleLabel("reader")).toBe("Lector");
		expect(roleLabel("author")).toBe("Autor");
		expect(roleLabel("editor")).toBe("Editor");
		expect(roleLabel("curator")).toBe("Curador");
		expect(roleLabel("admin")).toBe("Administrador");
	});

	test("un rol desconocido, vacío o ausente cae en lector", () => {
		const reader = roleLabel("reader");
		expect(roleLabel("superadmin")).toBe(reader);
		expect(roleLabel("")).toBe(reader);
		expect(roleLabel(undefined)).toBe(reader);
		expect(roleLabel(null)).toBe(reader);
	});
});
