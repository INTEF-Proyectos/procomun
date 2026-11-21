import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

type DockerJob = {
	strategy: { matrix: { include: { target: string; suffix: string }[] } };
	env: { IMAGE_NAME: string };
	steps: { id?: string; uses?: string; with?: Record<string, unknown> }[];
};

test("publica y escanea app y thumbnailer con las mismas etiquetas", () => {
	const { jobs } = Bun.YAML.parse(
		readFileSync(".github/workflows/ci.yml", "utf8"),
	) as { jobs: { docker: DockerJob } };
	const docker = jobs.docker;

	expect(docker.strategy.matrix.include).toEqual([
		{ target: "app", suffix: "" },
		{ target: "thumbnailer", suffix: "-thumbnailer" },
	]);
	expect(docker.env.IMAGE_NAME).toBe(
		`ghcr.io/\${{ github.repository }}\${{ matrix.suffix }}`,
	);

	const publish = docker.steps.find((step) => step.id === "publish");
	expect(publish?.with).toMatchObject({
		target: `\${{ matrix.target }}`,
		push: true,
		tags: `\${{ env.IMAGE_NAME }}:main\n\${{ env.IMAGE_NAME }}:latest\n`,
	});
	const scan = docker.steps.find((step) =>
		step.uses?.startsWith("aquasecurity/trivy-action@"),
	);
	expect(scan?.with?.["image-ref"]).toBe(
		`\${{ env.IMAGE_NAME }}@\${{ steps.publish.outputs.digest }}`,
	);
});

test("agrupa las actualizaciones de Playwright y exige que las versiones coincidan", () => {
	const { updates } = Bun.YAML.parse(
		readFileSync(".github/dependabot.yml", "utf8"),
	) as {
		updates: {
			"package-ecosystem": string;
			groups?: Record<string, { patterns: string[] }>;
		}[];
	};
	const bun = updates.find((update) => update["package-ecosystem"] === "bun");
	expect(bun?.groups?.playwright?.patterns).toEqual([
		"@playwright/test",
		"playwright-core",
	]);
	expect(Object.keys(bun?.groups ?? {}).indexOf("playwright")).toBeLessThan(
		Object.keys(bun?.groups ?? {}).indexOf("minor-patch"),
	);

	const root = JSON.parse(readFileSync("package.json", "utf8"));
	const thumbnailer = JSON.parse(
		readFileSync("apps/thumbnailer/package.json", "utf8"),
	);
	expect(root.devDependencies["@playwright/test"]).toMatch(/^\d+\.\d+\.\d+$/);
	expect(thumbnailer.dependencies["playwright-core"]).toBe(
		root.devDependencies["@playwright/test"],
	);
});
