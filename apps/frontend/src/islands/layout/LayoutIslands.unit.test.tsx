import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BaseNavIsland } from "./BaseNavIsland.tsx";
import { PublicNavIsland, toNavUser } from "./PublicNavIsland.tsx";

function sha256Hex(value: string): string {
	return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

describe("toNavUser (#514)", () => {
	test("calcula el avatar con el SHA-256 del correo normalizado de la sesión", async () => {
		const navUser = await toNavUser({
			id: "u1",
			email: "  Docente.Prueba@Example.ORG ",
			name: "Docente",
			role: "author",
		});

		expect(navUser.avatarUrl).toBe(
			`https://www.gravatar.com/avatar/${sha256Hex("docente.prueba@example.org")}?s=80&d=mp`,
		);
		expect(navUser).toMatchObject({
			id: "u1",
			name: "Docente",
			role: "author",
		});
	});
});

describe("Layout islands", () => {
	test("BaseNavIsland renderiza el shell de navegación pública", () => {
		const html = renderToStaticMarkup(<BaseNavIsland />);

		expect(html).toContain("Crear recurso");
		expect(html).toContain("Iniciar sesion");
	});

	test("PublicNavIsland mantiene visible el acceso a ayuda", () => {
		const html = renderToStaticMarkup(<PublicNavIsland />);

		expect(html).toContain("Ayuda");
		expect(html).toContain("help");
	});
});
