import { afterEach, describe, expect, test } from "bun:test";
import { configuredEmbedMode, resolveEmbedMode } from "./embed-mode.ts";

describe("resolveEmbedMode", () => {
	test("defaults to strict when unset", () => {
		expect(resolveEmbedMode()).toBe("strict");
		expect(resolveEmbedMode(null)).toBe("strict");
		expect(resolveEmbedMode("")).toBe("strict");
	});

	test("returns open only for an explicit 'open' opt-in", () => {
		expect(resolveEmbedMode("open")).toBe("open");
	});

	test("fails safe to strict for any unrecognised or tampered value", () => {
		// The relay treats anything != 'strict' as open, so these must resolve to strict here.
		expect(resolveEmbedMode("OPEN")).toBe("strict");
		expect(resolveEmbedMode("loose")).toBe("strict");
		expect(resolveEmbedMode("strict")).toBe("strict");
		expect(resolveEmbedMode("../../evil")).toBe("strict");
		expect(resolveEmbedMode("open ")).toBe("strict");
	});
});

describe("configuredEmbedMode", () => {
	const env = import.meta.env as Record<string, string | undefined>;
	const original = env.PUBLIC_EXELEARNING_EMBED_MODE;
	afterEach(() => {
		env.PUBLIC_EXELEARNING_EMBED_MODE = original;
	});

	test("returns 'open' only when the deployment env var explicitly opts in", () => {
		env.PUBLIC_EXELEARNING_EMBED_MODE = "open";
		expect(configuredEmbedMode()).toBe("open");
	});

	test("fails safe to 'strict' when the env var is unset or unrecognised", () => {
		env.PUBLIC_EXELEARNING_EMBED_MODE = undefined;
		expect(configuredEmbedMode()).toBe("strict");
		env.PUBLIC_EXELEARNING_EMBED_MODE = "loose";
		expect(configuredEmbedMode()).toBe("strict");
	});
});
