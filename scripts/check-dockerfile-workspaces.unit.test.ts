import { describe, expect, it } from "bun:test";

/**
 * Bun instala con linker aislado: las dependencias reales viven en
 * `node_modules/.bun/` y cada workspace recibe una granja de symlinks en su
 * propio `node_modules`. Una etapa que copia el codigo de un workspace pero no
 * su `node_modules` arranca sin `hono`, `better-auth`, `drizzle-orm` ni el
 * enlace `@procomun/db`, y el contenedor entra en bucle de reinicio.
 */

type Stage = { name: string; lines: string[] };

function parseStages(dockerfile: string): Stage[] {
	const stages: Stage[] = [];
	for (const line of dockerfile.split("\n")) {
		const name = line.match(/^FROM\s+\S+\s+AS\s+(\S+)/i)?.[1];
		if (name) stages.push({ name, lines: [] });
		else stages.at(-1)?.lines.push(line.trim());
	}
	return stages;
}

const WORKSPACES = ["apps/api", "apps/cli", "apps/frontend", "packages/db"];

const stages = parseStages(await Bun.file("Dockerfile").text());

describe("Dockerfile: node_modules de cada workspace", () => {
	it("encuentra las etapas del Dockerfile", () => {
		expect(stages.map((s) => s.name)).toContain("app");
	});

	for (const stage of stages) {
		const copiesRootDeps = stage.lines.some((l) =>
			/^COPY --from=\S+ \/app\/node_modules /.test(l),
		);
		if (!copiesRootDeps) continue;

		for (const ws of WORKSPACES) {
			const copiesSource = stage.lines.some((l) =>
				new RegExp(`^COPY ${ws}/ `).test(l),
			);
			if (!copiesSource) continue;

			it(`la etapa "${stage.name}" copia ${ws}/node_modules`, () => {
				const copiesDeps = stage.lines.some(
					(l) => l.includes("--from=") && l.includes(`/app/${ws}/node_modules`),
				);
				expect(copiesDeps).toBe(true);
			});
		}
	}
});
