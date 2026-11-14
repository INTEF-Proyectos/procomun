import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

/**
 * #564: desde Playwright 1.65 el runner corre bajo Bun, pero solo con `--bun`.
 * Sin él, el shebang `#!/usr/bin/env node` del CLI lo lanza en Node. Este test
 * impide volver a añadir un `playwright test` en los scripts o en los
 * workflows que se salte Bun.
 *
 * Excepción: `--ui`. Bajo Bun no hay modo watch y la UI no relanza los tests
 * al cambiar un fichero, así que `test:e2e:ui` sigue en Node.
 */

const WORKFLOWS_DIR = ".github/workflows";

function playwrightTestCalls(): { where: string; line: string }[] {
	const found: { where: string; line: string }[] = [];
	const scripts: Record<string, string> =
		JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {};
	for (const [name, cmd] of Object.entries(scripts)) {
		if (/playwright test\b/.test(cmd)) {
			found.push({ where: `package.json#${name}`, line: cmd });
		}
	}
	for (const file of readdirSync(WORKFLOWS_DIR)) {
		if (!/\.ya?ml$/.test(file)) continue;
		const text = readFileSync(`${WORKFLOWS_DIR}/${file}`, "utf8");
		for (const line of text.split("\n")) {
			if (/playwright test\b/.test(line)) {
				found.push({ where: file, line: line.trim() });
			}
		}
	}
	return found;
}

describe("Playwright bajo Bun", () => {
	const calls = playwrightTestCalls();

	it("encuentra llamadas a playwright test en scripts y workflows", () => {
		expect(calls.some((c) => c.where.startsWith("package.json"))).toBe(true);
		expect(calls.some((c) => c.where === "e2e.yml")).toBe(true);
	});

	it("todas usan bunx --bun, salvo la UI", () => {
		const sinBun = calls.filter(
			(c) =>
				!/bunx --bun playwright test\b/.test(c.line) &&
				!/\s--ui\b/.test(c.line),
		);
		expect(sinBun).toEqual([]);
	});
});
