import { describe, expect, test } from "bun:test";

import { applySuccessfulCliExit } from "./exit-code.ts";
import { CLI_COMMANDS, loadCommand, printHelp } from "./index.ts";

describe("CLI dispatcher", () => {
	test("lista los comandos públicos", () => {
		expect(CLI_COMMANDS).toContain("seed");
		expect(CLI_COMMANDS).toContain("fts:reindex");
		expect(CLI_COMMANDS).toContain("import:legacy-procomun");
		expect(CLI_COMMANDS).toContain("import:legacy-users");
		expect(CLI_COMMANDS).toContain("catalog:area-keywords");
		expect(CLI_COMMANDS).toContain("import:legacy-keywords");
	});

	test("devuelve null para comandos desconocidos", async () => {
		await expect(loadCommand("missing")).resolves.toBeNull();
	});

	test("imprime ayuda sin cargar handlers", () => {
		const lines: string[] = [];

		printHelp({ log: (line) => lines.push(line) });

		expect(lines.join("\n")).toContain("seed");
		expect(lines.join("\n")).toContain("fts:reindex");
		expect(lines.join("\n")).toContain("import:legacy-procomun");
		expect(lines.join("\n")).toContain("--link-authors");
		expect(lines.join("\n")).toContain("import:legacy-users");
		expect(lines.join("\n")).toContain("catalog:area-keywords");
		expect(lines.join("\n")).toContain("import:legacy-keywords");
	});

	test("un comando que termina bien no propaga el 99 residual de PGlite", () => {
		process.exitCode = 99;
		try {
			expect(applySuccessfulCliExit()).toBe(0);
			expect(process.exitCode).toBe(0);
		} finally {
			process.exitCode = 0;
		}
	});
});
