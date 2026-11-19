import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { DEFAULT_LICENSE, VALID_LICENSES } from "./validation.ts";

/**
 * La licencia por defecto se escribe una sola vez, en `DEFAULT_LICENSE`
 * (#522). Este test busca en el código productivo de `apps/` y `packages/`
 * los usos del literal como valor por defecto (`license: "cc-by"`,
 * `?? "cc-by"`, `license = "cc-by"`, `defaultValue="cc-by"`…) y falla si
 * vuelve a aparecer alguno.
 *
 * El literal sigue siendo válido como opción de una lista o como clave de un
 * mapa (`value: "cc-by"`, `<option value="cc-by">`, `"cc-by": {…}`), porque
 * ahí no es la licencia por defecto, sino una de las licencias.
 */

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const SOURCE_ROOTS = [
	"apps/api/src",
	"apps/cli/src",
	"apps/frontend/src",
	"packages/db/src",
];

/** Datos de ejemplo, no valores por defecto de la plataforma. */
const ALLOWED_PATHS = [
	"packages/db/src/validation.ts",
	"packages/db/src/seed-data.ts",
	"apps/frontend/src/lib/mock/",
	"apps/api/src/test-fixtures/",
];

const DEFAULT_USE =
	/(?:license\s*[:=]\s*|\?\?\s*|\|\|\s*|defaultValue\s*=\s*\{?\s*)["'`]cc-by["'`]/;

function isTestFile(file: string): boolean {
	return /\.test\.tsx?$/.test(file);
}

async function* sourceFiles(dir: string): AsyncGenerator<string> {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name === "paraglide") continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) yield* sourceFiles(full);
		else if (/\.tsx?$/.test(entry.name) && !isTestFile(entry.name)) yield full;
	}
}

function findDefaultLicenseLiterals(file: string, text: string): string[] {
	const hits: string[] = [];
	text.split("\n").forEach((line, index) => {
		if (DEFAULT_USE.test(line))
			hits.push(`${file}:${index + 1}: ${line.trim()}`);
	});
	return hits;
}

describe("licencia por defecto (#522)", () => {
	test("DEFAULT_LICENSE es una de las licencias válidas", () => {
		expect(VALID_LICENSES).toContain(DEFAULT_LICENSE);
	});

	test("el detector reconoce los usos por defecto y deja pasar las opciones", () => {
		const sample = [
			'license: "cc-by",',
			'license: resource.license ?? "cc-by",',
			'const { license = "cc-by" } = opts;',
			'defaultValue="cc-by"',
			'{ value: "cc-by", label: "CC BY" },',
			'<option value="cc-by">CC BY</option>',
			'"cc-by": { label: "CC BY" },',
			"license: DEFAULT_LICENSE,",
		].join("\n");
		expect(findDefaultLicenseLiterals("x.ts", sample)).toEqual([
			'x.ts:1: license: "cc-by",',
			'x.ts:2: license: resource.license ?? "cc-by",',
			'x.ts:3: const { license = "cc-by" } = opts;',
			'x.ts:4: defaultValue="cc-by"',
		]);
	});

	test('el código productivo no escribe "cc-by" como valor por defecto', async () => {
		const hits: string[] = [];
		for (const root of SOURCE_ROOTS) {
			for await (const file of sourceFiles(path.join(REPO_ROOT, root))) {
				const rel = path.relative(REPO_ROOT, file).split(path.sep).join("/");
				if (ALLOWED_PATHS.some((allowed) => rel.startsWith(allowed))) continue;
				hits.push(
					...findDefaultLicenseLiterals(rel, await readFile(file, "utf8")),
				);
			}
		}
		expect(hits).toEqual([]);
	});
});
