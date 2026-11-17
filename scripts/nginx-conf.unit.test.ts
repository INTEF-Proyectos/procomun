import { describe, expect, it } from "bun:test";

/**
 * nginx elige una `location` por regex antes que un prefijo normal. La de
 * estáticos (`\.(js|css|png|jpg|…)$`) se queda con cualquier ruta que acabe
 * en esas extensiones, también las de la API, salvo que el prefijo lleve `^~`.
 * Las miniaturas (`/api/v1/thumbnails/<sha256>.jpg`, #472, #470) tienen que
 * llegar a la API: es quien comprueba el estado del recurso y pone su
 * `Cache-Control` (revisión de #481, adenda 2026-11-03 de ADR-0046).
 */

type Location = { modifier: string; path: string; body: string };

function parseLocations(conf: string): Location[] {
	const locations: Location[] = [];
	const re = /location\s+(\^~|~\*|~|=)?\s*(\S+)\s*\{([^}]*)\}/g;
	for (const match of conf.matchAll(re)) {
		locations.push({
			modifier: match[1] ?? "",
			path: match[2] as string,
			body: match[3] as string,
		});
	}
	return locations;
}

const locations = parseLocations(await Bun.file("nginx.conf").text());
const byPath = (path: string) => locations.find((loc) => loc.path === path);

describe("nginx.conf", () => {
	it("tiene la location de estáticos por extensión que obliga a usar ^~", () => {
		const statics = locations.find(
			(loc) => loc.modifier === "~*" && loc.path.includes("jpg"),
		);
		expect(statics).toBeDefined();
	});

	for (const path of ["/api/v1/elpx/", "/api/v1/thumbnails/"]) {
		it(`${path} va a la API con ^~ y sin caché propia de nginx`, () => {
			const loc = byPath(path);
			expect(loc?.modifier).toBe("^~");
			expect(loc?.body).toContain("proxy_pass http://api:3000;");
			expect(loc?.body).not.toMatch(/\bexpires\b/);
			expect(loc?.body).not.toMatch(/Cache-Control/i);
		});
	}
});
