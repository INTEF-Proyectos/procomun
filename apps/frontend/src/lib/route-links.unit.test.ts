import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * #535: el boton «Saber mas» de la portada enlazaba a `url("sobre")`, y la ruta
 * `sobre` no existe en App.tsx, asi que llevaba a una pagina vacia. Nadie lo
 * detecto porque un `url()` acepta cualquier cadena.
 *
 * Este test recorre el codigo del frontend, saca el destino de cada `url(...)`
 * con una cadena literal y comprueba que hay una ruta que lo sirve. Es el
 * guard que habria pillado el defecto, y vale para cualquier enlace muerto que
 * se escriba a partir de ahora.
 */

const SRC = join(import.meta.dir, "..");
const APP = readFileSync(join(SRC, "App.tsx"), "utf8");

/** Rutas declaradas en App.tsx, tal y como las escribe react-router. */
export function declaredRoutes(appSource: string): string[] {
	return [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)]
		.map((m) => m[1] as string)
		.filter((p) => p !== ":locale");
}

/**
 * Destinos de `url("…")` con cadena literal. Se ignora `url(variable)`, que
 * no se puede comprobar en estatico, y los que empiezan por `api/`: `url()`
 * sirve tambien para construir rutas del backend con el base path (la
 * portada del editor de eXeLearning, el analisis del .elpx), que no las
 * sirve el router.
 */
export function literalUrlTargets(source: string): string[] {
	return [...source.matchAll(/\burl\(\s*"([^"`$]*)"/g)]
		.map((m) => (m[1] as string).replace(/^\//, ""))
		.filter((target) => !target.startsWith("api/"));
}

/**
 * Una ruta sirve un destino si coincide, si el destino cae bajo un comodin
 * (`admin/*`) o si encaja con un segmento dinamico (`tags/:slug`).
 */
export function isServedBy(target: string, route: string): boolean {
	const clean = (target.split("?")[0] ?? "").split("#")[0] ?? "";
	if (clean === "" || route === clean) return true;
	if (route.endsWith("/*")) {
		const prefix = route.slice(0, -2);
		return clean === prefix || clean.startsWith(`${prefix}/`);
	}
	const routeParts = route.split("/");
	const targetParts = clean.split("/");
	if (routeParts.length !== targetParts.length) return false;
	return routeParts.every(
		(part, i) => part.startsWith(":") || part === targetParts[i],
	);
}

function sourceFiles(dir: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (entry === "paraglide" || entry === "node_modules") continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			found.push(...sourceFiles(full));
		} else if (
			(entry.endsWith(".tsx") || entry.endsWith(".ts")) &&
			!entry.includes(".test.")
		) {
			found.push(full);
		}
	}
	return found;
}

describe("helpers del guard de enlaces", () => {
	test("declaredRoutes lee las rutas y descarta el comodin de idioma", () => {
		const routes = declaredRoutes(APP);
		expect(routes).toContain("login");
		expect(routes).toContain("admin/*");
		expect(routes).not.toContain(":locale");
	});

	test("literalUrlTargets saca el destino y quita la barra inicial", () => {
		expect(literalUrlTargets('url("registro")')).toEqual(["registro"]);
		expect(literalUrlTargets('url("/perfil")')).toEqual(["perfil"]);
		// Un destino construido en tiempo de ejecucion no se puede comprobar.
		expect(literalUrlTargets("url(`recurso?slug=${slug}`)")).toEqual([]);
		expect(literalUrlTargets("url(destino)")).toEqual([]);
		// Las rutas del backend no las sirve el router.
		expect(literalUrlTargets('url("api/admin/elpx/analyze")')).toEqual([]);
	});

	test("isServedBy acepta comodines, segmentos dinamicos y query", () => {
		expect(isServedBy("admin/usuarios", "admin/*")).toBe(true);
		expect(isServedBy("admin", "admin/*")).toBe(true);
		expect(isServedBy("tags/matematicas", "tags/:slug")).toBe(true);
		expect(isServedBy("recurso?slug=x", "recurso")).toBe(true);
		expect(isServedBy("", "login")).toBe(true);
		expect(isServedBy("sobre", "login")).toBe(false);
		expect(isServedBy("sobre/nosotros", "sobre")).toBe(false);
	});

	test("detecta el enlace muerto de #535", () => {
		const routes = declaredRoutes(APP);
		expect(routes.some((r) => isServedBy("sobre", r))).toBe(false);
	});
});

describe("ningun url() literal apunta a una ruta que no existe (#535)", () => {
	test("todos los destinos tienen ruta en App.tsx", () => {
		const routes = declaredRoutes(APP);
		const dead: string[] = [];

		for (const file of sourceFiles(SRC)) {
			for (const target of literalUrlTargets(readFileSync(file, "utf8"))) {
				if (!routes.some((route) => isServedBy(target, route))) {
					dead.push(`${file.slice(SRC.length + 1)} → url("${target}")`);
				}
			}
		}

		expect(dead).toEqual([]);
	});
});
