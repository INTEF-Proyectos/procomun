import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type DesignContract = {
	colors: Record<string, string>;
	components: Record<string, unknown>;
	description?: string;
	name?: string;
	rounded: Record<string, string>;
	spacing: Record<string, string>;
	typography: Record<string, unknown>;
	version?: string;
};

type CheckResult = {
	errors: string[];
};

const REQUIRED_TOP_LEVEL_FIELDS = [
	"version",
	"name",
	"description",
	"colors",
	"typography",
	"rounded",
	"spacing",
	"components",
] as const;

const REQUIRED_COLOR_TOKENS = [
	"primary",
	"secondary",
	"tertiary",
	"error",
	"background",
	"surface",
	"on-surface",
	"outline",
] as const;

const REQUIRED_COMPONENTS = [
	"button-primary",
	"button-secondary",
	"input",
	"chip",
	"card",
	"navigation",
] as const;

const CSS_TOKEN_MAP = {
	"colors.primary": "--color-primary",
	"colors.secondary": "--color-secondary",
	"colors.tertiary": "--color-tertiary",
	"colors.error": "--color-error",
	"colors.background": "--color-background",
	"colors.surface": "--color-surface",
	"colors.on-surface": "--color-on-surface",
	"colors.outline": "--color-outline",
	"spacing.4": "--space-4",
	"rounded.md": "--radius-md",
} as const;

export function extractFrontMatter(markdown: string) {
	const normalized = markdown.replaceAll("\r\n", "\n");
	if (!normalized.startsWith("---\n")) {
		throw new Error("DESIGN.md must start with YAML front matter.");
	}

	const endIndex = normalized.indexOf("\n---\n", 4);
	if (endIndex === -1) {
		throw new Error("DESIGN.md front matter must end with ---.");
	}

	return normalized.slice(4, endIndex);
}

export function parseSimpleDesignFrontMatter(
	frontMatter: string,
): DesignContract {
	const root: Record<string, unknown> = {};
	const stack: Array<{ indent: number; object: Record<string, unknown> }> = [
		{ indent: -1, object: root },
	];

	for (const rawLine of frontMatter.split("\n")) {
		if (!rawLine.trim() || rawLine.trimStart().startsWith("#")) continue;

		const indent = rawLine.match(/^ */)?.[0].length ?? 0;
		const trimmed = rawLine.trim();
		const separatorIndex = trimmed.indexOf(":");
		if (separatorIndex === -1) continue;

		const key = trimmed.slice(0, separatorIndex).trim();
		const rawValue = trimmed.slice(separatorIndex + 1).trim();

		while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
			stack.pop();
		}

		const parent = stack[stack.length - 1].object;
		if (rawValue === "") {
			const nested: Record<string, unknown> = {};
			parent[key] = nested;
			stack.push({ indent, object: nested });
			continue;
		}

		parent[key] = normalizeScalar(rawValue);
	}

	return root as DesignContract;
}

function normalizeScalar(value: string) {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}

	return value;
}

export function extractCssCustomProperties(css: string) {
	const tokens: Record<string, string> = {};
	const tokenPattern = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;

	for (const match of css.matchAll(tokenPattern)) {
		const name = match[1];
		const value = match[2];
		if (name !== undefined && value !== undefined) {
			tokens[name] = value.trim();
		}
	}

	return tokens;
}

export function checkDesignContract(
	design: DesignContract,
	cssTokens: Record<string, string>,
): CheckResult {
	const errors: string[] = [];

	for (const field of REQUIRED_TOP_LEVEL_FIELDS) {
		if (!(field in design)) {
			errors.push(`Missing required field: ${field}`);
		}
	}

	if (design.version !== "alpha") {
		errors.push('Expected version to be "alpha".');
	}

	for (const token of REQUIRED_COLOR_TOKENS) {
		if (!design.colors?.[token]) {
			errors.push(`Missing required color token: colors.${token}`);
		}
	}

	for (const component of REQUIRED_COMPONENTS) {
		if (!design.components?.[component]) {
			errors.push(`Missing required component token: components.${component}`);
		}
	}

	for (const [designPath, cssToken] of Object.entries(CSS_TOKEN_MAP)) {
		const designValue = getDesignValue(design, designPath);
		const cssValue = cssTokens[cssToken];

		if (!designValue) {
			errors.push(`Missing token for CSS sync: ${designPath}`);
			continue;
		}

		if (!cssValue) {
			errors.push(`Missing CSS custom property: ${cssToken}`);
			continue;
		}

		if (designValue.toLowerCase() !== cssValue.toLowerCase()) {
			errors.push(
				`${designPath} (${designValue}) does not match ${cssToken} (${cssValue}).`,
			);
		}
	}

	return { errors };
}

function getDesignValue(design: DesignContract, path: string) {
	const [group, token] = path.split(".");
	const value = (
		design as unknown as Record<string, Record<string, string> | undefined>
	)[group]?.[token];
	return typeof value === "string" ? value : undefined;
}

async function main() {
	const rootDir = process.cwd();
	const designMarkdown = await readFile(join(rootDir, "DESIGN.md"), "utf8");
	const css = await readFile(
		join(rootDir, "apps/frontend/src/styles/design-tokens.css"),
		"utf8",
	);
	const design = parseSimpleDesignFrontMatter(
		extractFrontMatter(designMarkdown),
	);
	const result = checkDesignContract(design, extractCssCustomProperties(css));

	if (result.errors.length === 0) {
		console.log("DESIGN.md contract is aligned with required project tokens.");
		return;
	}

	console.error("DESIGN.md contract validation failed:");
	for (const error of result.errors) {
		console.error(`- ${error}`);
	}
	process.exit(1);
}

if (import.meta.main) {
	await main();
}
