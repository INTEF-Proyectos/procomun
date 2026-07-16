import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	configure,
	getManifestIds,
	getResource,
	hasResource,
	resetDependencies,
} from "./preview-fixed-resources.ts";

let distRoot: string;
let outsideRoot: string;

/** Point the resolver at a throwaway distribution root with the given manifest. */
function useManifest(manifest: unknown | null): void {
	const bundlesDir = path.join(distRoot, "bundles");
	fs.mkdirSync(bundlesDir, { recursive: true });
	const manifestPath = path.join(bundlesDir, "preview-fixed-resources.json");
	if (manifest === null) {
		// Leave the manifest absent.
		if (fs.existsSync(manifestPath)) fs.rmSync(manifestPath);
	} else if (typeof manifest === "string") {
		fs.writeFileSync(manifestPath, manifest); // deliberately malformed JSON
	} else {
		fs.writeFileSync(manifestPath, JSON.stringify(manifest));
	}
	configure({ distRoot, manifestPath });
}

function writeResource(relPath: string, content: string): void {
	const full = path.join(distRoot, relPath);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, content);
}

beforeEach(() => {
	distRoot = fs.mkdtempSync(path.join(os.tmpdir(), "preview-fixed-dist-"));
	outsideRoot = fs.mkdtempSync(
		path.join(os.tmpdir(), "preview-fixed-outside-"),
	);
});

afterEach(() => {
	resetDependencies();
	fs.rmSync(distRoot, { recursive: true, force: true });
	fs.rmSync(outsideRoot, { recursive: true, force: true });
});

describe("preview fixed-resource resolver", () => {
	it("disables the layer when the manifest is absent (no throw)", () => {
		useManifest(null);
		expect(hasResource("libs/jquery/jquery.min.js")).toBe(false);
		expect(getResource("libs/jquery/jquery.min.js")).toBeNull();
		expect(getManifestIds()).toEqual([]);
	});

	it("disables the layer when the manifest JSON is malformed", () => {
		useManifest("{ not valid json");
		expect(hasResource("anything")).toBe(false);
		expect(getManifestIds()).toEqual([]);
	});

	it("disables the layer when the schemaVersion is unsupported", () => {
		useManifest({
			schemaVersion: 2,
			buildVersion: "x",
			resources: { a: { path: "a.js", size: 1 } },
		});
		expect(hasResource("a")).toBe(false);
	});

	it("resolves a listed id to its exact bytes", () => {
		writeResource("libs/jquery/jquery.min.js", "window.jQuery=function(){};");
		useManifest({
			schemaVersion: 1,
			buildVersion: "test",
			resources: {
				"libs/jquery/jquery.min.js": {
					path: "libs/jquery/jquery.min.js",
					size: 27,
				},
			},
		});
		expect(hasResource("libs/jquery/jquery.min.js")).toBe(true);
		expect(getManifestIds()).toEqual(["libs/jquery/jquery.min.js"]);
		const resolved = getResource("libs/jquery/jquery.min.js");
		expect(resolved).not.toBeNull();
		expect(new TextDecoder().decode(resolved?.bytes)).toBe(
			"window.jQuery=function(){};",
		);
		expect(resolved?.size).toBe(27);
	});

	it("resolves an id whose served path differs from its manifest path", () => {
		writeResource("files/perm/themes/base/base/icon.svg", "<svg/>");
		useManifest({
			schemaVersion: 1,
			buildVersion: "test",
			resources: {
				"theme:base/icon.svg": {
					path: "files/perm/themes/base/base/icon.svg",
					size: 6,
				},
			},
		});
		expect(
			new TextDecoder().decode(getResource("theme:base/icon.svg")?.bytes),
		).toBe("<svg/>");
	});

	it("returns null for ids not present in the manifest (never a filesystem probe)", () => {
		writeResource("libs/a.js", "a");
		useManifest({
			schemaVersion: 1,
			buildVersion: "test",
			resources: { "libs/a.js": { path: "libs/a.js", size: 1 } },
		});
		expect(hasResource("libs/b.js")).toBe(false);
		expect(getResource("libs/b.js")).toBeNull();
	});

	it("returns null when the manifest lists a file that is absent on disk", () => {
		useManifest({
			schemaVersion: 1,
			buildVersion: "test",
			resources: { "gone.js": { path: "gone.js", size: 10 } },
		});
		expect(hasResource("gone.js")).toBe(true);
		expect(getResource("gone.js")).toBeNull();
	});

	it("rejects a manifest path that escapes the distribution root with ..", () => {
		fs.writeFileSync(path.join(outsideRoot, "secret.txt"), "TOP SECRET");
		useManifest({
			schemaVersion: 1,
			buildVersion: "test",
			resources: { escape: { path: "../../secret.txt", size: 10 } },
		});
		// The id is listed, but the path resolves outside the root → miss.
		expect(hasResource("escape")).toBe(true);
		expect(getResource("escape")).toBeNull();
	});

	it("rejects an absolute manifest path", () => {
		const absolute = path.join(outsideRoot, "secret.txt");
		fs.writeFileSync(absolute, "TOP SECRET");
		useManifest({
			schemaVersion: 1,
			buildVersion: "test",
			resources: { abs: { path: absolute, size: 10 } },
		});
		expect(getResource("abs")).toBeNull();
	});

	it("does not follow a symlink that escapes the distribution root", () => {
		const secret = path.join(outsideRoot, "secret.txt");
		fs.writeFileSync(secret, "TOP SECRET");
		const link = path.join(distRoot, "evil-link");
		fs.symlinkSync(secret, link);
		useManifest({
			schemaVersion: 1,
			buildVersion: "test",
			resources: { evil: { path: "evil-link", size: 10 } },
		});
		// Lexically inside the root, but realpath escapes it → miss.
		expect(getResource("evil")).toBeNull();
	});

	it("returns null when the distribution root itself cannot be resolved", () => {
		const bundlesDir = path.join(distRoot, "bundles");
		fs.mkdirSync(bundlesDir, { recursive: true });
		const manifestPath = path.join(bundlesDir, "preview-fixed-resources.json");
		fs.writeFileSync(
			manifestPath,
			JSON.stringify({
				schemaVersion: 1,
				buildVersion: "test",
				resources: { x: { path: "x.js", size: 1 } },
			}),
		);
		// The manifest loads, but the configured root does not exist on disk.
		configure({
			distRoot: path.join(distRoot, "does-not-exist"),
			manifestPath,
		});
		expect(hasResource("x")).toBe(true);
		expect(getResource("x")).toBeNull();
	});

	it("skips manifest entries without a string path", () => {
		useManifest({
			schemaVersion: 1,
			buildVersion: "test",
			resources: { good: { path: "good.js", size: 1 }, bad: { size: 1 } },
		});
		expect(hasResource("good")).toBe(true);
		expect(hasResource("bad")).toBe(false);
	});

	it("configure() resets the cached manifest so a later manifest is picked up", () => {
		useManifest({ schemaVersion: 1, buildVersion: "test", resources: {} });
		expect(hasResource("libs/a.js")).toBe(false);
		writeResource("libs/a.js", "a");
		useManifest({
			schemaVersion: 1,
			buildVersion: "test",
			resources: { "libs/a.js": { path: "libs/a.js", size: 1 } },
		});
		expect(hasResource("libs/a.js")).toBe(true);
	});
});
