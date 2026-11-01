import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

/**
 * #489: con Bun 1.3.14 en Linux, importar `@electric-sql/pglite` deja el
 * proceso en unos 4 GB de RSS (en macOS no pasa). La API de los e2e usa PGlite,
 * así que ocupaba más de la mitad del runner (7,9 GB). Cuando Chromium abría
 * pestañas de más, el OOM killer mataba la API y el resto de la suite fallaba
 * con 502. Bun 1.4.0 ya no tiene el problema (unos 50 MB). Este test impide
 * volver a fijar una 1.3 en los workflows y que cada workflow fije una versión
 * distinta.
 */

const WORKFLOWS_DIR = ".github/workflows";

function bunVersions(): { file: string; version: string }[] {
	const found: { file: string; version: string }[] = [];
	for (const file of readdirSync(WORKFLOWS_DIR)) {
		if (!/\.ya?ml$/.test(file)) continue;
		const text = readFileSync(`${WORKFLOWS_DIR}/${file}`, "utf8");
		for (const m of text.matchAll(/bun-version:\s*["']?([^\s"'#]+)/g)) {
			found.push({ file, version: m[1] as string });
		}
	}
	return found;
}

function atLeast(version: string, min: [number, number]): boolean {
	const [major = 0, minor = 0] = version.split(".").map(Number);
	return major > min[0] || (major === min[0] && minor >= min[1]);
}

describe("versión de Bun en los workflows", () => {
	const versions = bunVersions();

	it("encuentra setup-bun en los workflows", () => {
		expect(versions.map((v) => v.file)).toContain("e2e.yml");
		expect(versions.map((v) => v.file)).toContain("ci.yml");
	});

	it("fija una versión exacta, la misma en todos", () => {
		for (const { version } of versions) {
			expect(version).toMatch(/^\d+\.\d+\.\d+$/);
		}
		expect(new Set(versions.map((v) => v.version)).size).toBe(1);
	});

	it("no baja de Bun 1.4 (PGlite con 1.3 agota la memoria del runner)", () => {
		for (const { version } of versions) {
			expect(atLeast(version, [1, 4])).toBe(true);
		}
	});

	it("la imagen Docker usa la misma versión que los workflows", () => {
		const dockerfile = readFileSync("Dockerfile", "utf8");
		const tags = [...dockerfile.matchAll(/^FROM\s+oven\/bun:(\S+)/gm)].map(
			(m) => m[1],
		);
		expect(tags.length).toBeGreaterThan(0);
		for (const tag of tags) {
			expect(tag).toBe(versions[0]?.version);
		}
	});

	it("la comparación de versiones rechaza la 1.3.14", () => {
		expect(atLeast("1.3.14", [1, 4])).toBe(false);
		expect(atLeast("1.4.0", [1, 4])).toBe(true);
		expect(atLeast("2.0.0", [1, 4])).toBe(true);
	});
});
