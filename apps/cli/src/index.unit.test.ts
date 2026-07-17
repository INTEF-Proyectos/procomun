import { describe, expect, test } from "bun:test";

import { CLI_COMMANDS, loadCommand, printHelp } from "./index.ts";

describe("CLI dispatcher", () => {
	test("lista los comandos públicos", () => {
		expect(CLI_COMMANDS).toContain("seed");
		expect(CLI_COMMANDS).toContain("fts:reindex");
		expect(CLI_COMMANDS).toContain("import:legacy-procomun");
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
	});
});
