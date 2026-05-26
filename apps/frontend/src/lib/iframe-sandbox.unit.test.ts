import { describe, expect, test } from "bun:test";

/**
 * DEF-002: Validates that preview iframes never combine allow-scripts + allow-same-origin
 * in their sandbox attribute, which causes browser warnings about sandbox escaping.
 *
 * "An iframe which has both allow-scripts and allow-same-origin for its sandbox attribute
 * can escape its sandboxing."
 */

/** Extract all sandbox attribute values from rendered HTML */
function extractSandboxAttrs(html: string): string[] {
	const matches = [...html.matchAll(/sandbox="([^"]+)"/g)];
	return matches.map((m) => m[1]!);
}

/** Check if a sandbox value has the dangerous combination */
function hasUnsafeSandbox(sandbox: string): boolean {
	const tokens = sandbox.split(/\s+/);
	return tokens.includes("allow-scripts") && tokens.includes("allow-same-origin");
}

describe("iframe sandbox security (DEF-002)", () => {
	test("catalog-controller renderCard no combina allow-scripts con allow-same-origin", async () => {
		// Import the module and check the sandbox string in the template
		const src = await Bun.file(
			new URL("./catalog-controller.ts", import.meta.url).pathname,
		).text();

		const sandboxMatches = [...src.matchAll(/sandbox="([^"]+)"/g)];
		for (const [, sandbox] of sandboxMatches) {
			expect(hasUnsafeSandbox(sandbox!)).toBe(false);
		}
	});

	test("HomeDataIsland preview iframe no combina allow-scripts con allow-same-origin", async () => {
		const src = await Bun.file(
			new URL("../islands/home/HomeDataIsland.tsx", import.meta.url).pathname,
		).text();

		const sandboxMatches = [...src.matchAll(/sandbox="([^"]+)"/g)];
		for (const [, sandbox] of sandboxMatches) {
			expect(hasUnsafeSandbox(sandbox!)).toBe(false);
		}
	});

	test("CatalogIsland preview iframe no combina allow-scripts con allow-same-origin", async () => {
		const src = await Bun.file(
			new URL("../islands/catalog/CatalogIsland.tsx", import.meta.url).pathname,
		).text();

		const sandboxMatches = [...src.matchAll(/sandbox="([^"]+)"/g)];
		for (const [, sandbox] of sandboxMatches) {
			expect(hasUnsafeSandbox(sandbox!)).toBe(false);
		}
	});

	test("ResourceDetailIsland preview iframe no combina allow-scripts con allow-same-origin", async () => {
		const src = await Bun.file(
			new URL("../islands/catalog/ResourceDetailIsland.tsx", import.meta.url).pathname,
		).text();

		const sandboxMatches = [...src.matchAll(/sandbox="([^"]+)"/g)];
		for (const [, sandbox] of sandboxMatches) {
			expect(hasUnsafeSandbox(sandbox!)).toBe(false);
		}
	});

	test("ResourceCard preview iframe no combina allow-scripts con allow-same-origin", async () => {
		const src = await Bun.file(
			new URL("../ui/ResourceCard.tsx", import.meta.url).pathname,
		).text();

		const sandboxMatches = [...src.matchAll(/sandbox="([^"]+)"/g)];
		for (const [, sandbox] of sandboxMatches) {
			expect(hasUnsafeSandbox(sandbox!)).toBe(false);
		}
	});

	test("PublicCollectionsIsland preview iframe no combina allow-scripts con allow-same-origin", async () => {
		const src = await Bun.file(
			new URL("../islands/collections/PublicCollectionsIsland.tsx", import.meta.url).pathname,
		).text();

		const sandboxMatches = [...src.matchAll(/sandbox="([^"]+)"/g)];
		for (const [, sandbox] of sandboxMatches) {
			expect(hasUnsafeSandbox(sandbox!)).toBe(false);
		}
	});

	test("EditarPage preview iframe no combina allow-scripts con allow-same-origin", async () => {
		const src = await Bun.file(
			new URL("../pages/EditarPage.tsx", import.meta.url).pathname,
		).text();

		// The editor iframe (exelearning-editor) legitimately needs allow-same-origin for API access.
		// Only preview iframes (class edit-preview-iframe) must not combine both.
		const previewSection = src.slice(
			src.indexOf("edit-preview-iframe"),
			src.indexOf("edit-preview-iframe") + 300,
		);
		const sandboxMatches = [...previewSection.matchAll(/sandbox="([^"]+)"/g)];
		for (const [, sandbox] of sandboxMatches) {
			expect(hasUnsafeSandbox(sandbox!)).toBe(false);
		}
	});

	test("ningun archivo de preview tiene la combinacion insegura allow-scripts + allow-same-origin", async () => {
		// Comprehensive check: read all relevant source files and ensure no preview iframe
		// has the unsafe sandbox combination
		const previewFiles = [
			"./catalog-controller.ts",
			"../islands/home/HomeDataIsland.tsx",
			"../islands/catalog/CatalogIsland.tsx",
			"../islands/catalog/ResourceDetailIsland.tsx",
			"../islands/collections/PublicCollectionsIsland.tsx",
			"../ui/ResourceCard.tsx",
		];

		for (const file of previewFiles) {
			const src = await Bun.file(
				new URL(file, import.meta.url).pathname,
			).text();

			const sandboxMatches = [...src.matchAll(/sandbox="([^"]+)"/g)];
			for (const [, sandbox] of sandboxMatches) {
				expect(hasUnsafeSandbox(sandbox!)).toBe(false);
			}
		}
	});
});
