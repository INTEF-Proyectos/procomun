/**
 * Conformance replay of the eXeLearning preview serving contract v2.
 *
 * `apps/api/test/preview-contract/vectors.json` is vendored byte-for-byte from
 * eXe core (`test/fixtures/preview-contract/vectors.json`). Every step is
 * replayed IN ORDER against this adapter's real routes, asserting the exact
 * status codes, body subsets, body text and headers the contract mandates — so
 * protocol semantics (not just the CSP string) stay aligned with core and the
 * other hosts. Do not fork the JSON; refresh it from core.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import * as fixedResources from "../services/preview-fixed-resources.ts";
import { resetDependencies } from "../services/preview-session-store.ts";
import { previewRoutes, previewSessionRoutes } from "./preview.ts";

interface HeaderMatcher {
	startsWith?: string;
	contains?: string;
	absent?: boolean;
}

interface VectorStep {
	id: string;
	comment?: string;
	request: {
		method: string;
		path: string;
		headers?: Record<string, string>;
		body?: {
			kind: "assets" | "revision";
			entries?: Array<{ key: string; content: string }>;
			meta?: Record<string, unknown>;
			writes?: Array<{ path: string; content: string }>;
		};
	};
	expect: {
		status: number;
		body?: unknown;
		bodyText?: string;
		headers?: Record<string, string | HeaderMatcher>;
	};
}

interface Vectors {
	protocolVersion: number;
	fixedResources: Record<string, { path: string; content: string }>;
	steps: VectorStep[];
}

const VECTORS: Vectors = JSON.parse(
	fs.readFileSync(
		path.join(
			import.meta.dir,
			"..",
			"..",
			"test",
			"preview-contract",
			"vectors.json",
		),
		"utf-8",
	),
);

const OWNER = {
	id: "conformance-owner",
	role: "author",
	email: "owner@test.local",
	name: "Owner",
};

/** Management runs authenticated as the owner; serving runs with no credentials. */
function appFor(user: Record<string, unknown> | null) {
	const app = new Hono<AuthEnv>();
	app.use("*", async (c, next) => {
		c.set("user", user as AuthEnv["Variables"]["user"]);
		c.set(
			"session",
			user ? ({ id: "s" } as AuthEnv["Variables"]["session"]) : null,
		);
		await next();
	});
	app.route("/api/v1/preview-session", previewSessionRoutes);
	app.route("/api/v1/preview", previewRoutes);
	return app;
}

const ownerApp = appFor(OWNER);
const anonApp = appFor(null);

/** Contract paths are basePath-relative; Procomún mounts under `/api/v1`. */
function toAppPath(contractPath: string): string {
	if (contractPath.startsWith("/api/preview-session")) {
		return contractPath.replace(
			"/api/preview-session",
			"/api/v1/preview-session",
		);
	}
	if (contractPath.startsWith("/preview")) {
		return contractPath.replace("/preview", "/api/v1/preview");
	}
	throw new Error(`unexpected contract path: ${contractPath}`);
}

function byteLength(text: string): number {
	return new TextEncoder().encode(text).length;
}

/** Recursive subset match: arrays exact, objects may carry extra keys. */
function expectBodySubset(actual: unknown, expected: unknown): void {
	if (Array.isArray(expected)) {
		expect(Array.isArray(actual)).toBe(true);
		expect((actual as unknown[]).length).toBe(expected.length);
		expected.forEach((item, i) => {
			expectBodySubset((actual as unknown[])[i], item);
		});
		return;
	}
	if (expected !== null && typeof expected === "object") {
		expect(typeof actual).toBe("object");
		expect(actual).not.toBeNull();
		for (const [key, value] of Object.entries(expected)) {
			expectBodySubset((actual as Record<string, unknown>)[key], value);
		}
		return;
	}
	expect(actual).toBe(expected);
}

function expectHeaders(
	res: Response,
	headers: Record<string, string | HeaderMatcher>,
): void {
	for (const [name, matcher] of Object.entries(headers)) {
		const value = res.headers.get(name); // case-insensitive per the Headers spec
		if (typeof matcher === "string") {
			expect(value).toBe(matcher);
		} else if (matcher.absent) {
			expect(value).toBeNull();
		} else if (matcher.startsWith !== undefined) {
			expect((value ?? "").startsWith(matcher.startsWith)).toBe(true);
		} else if (matcher.contains !== undefined) {
			expect(value ?? "").toContain(matcher.contains);
		}
	}
}

function buildRequestInit(step: VectorStep): {
	init: RequestInit;
	authed: boolean;
} {
	const req = step.request;
	const authed = req.path.startsWith("/api/preview-session");
	const init: RequestInit = { method: req.method, headers: req.headers };

	const body = req.body;
	if (body?.kind === "assets") {
		const form = new FormData();
		form.append(
			"assets",
			JSON.stringify(
				(body.entries ?? []).map((e) => ({
					key: e.key,
					size: byteLength(e.content),
				})),
			),
		);
		for (const e of body.entries ?? [])
			form.append("files", new Blob([new TextEncoder().encode(e.content)]));
		init.body = form;
	} else if (body?.kind === "revision") {
		const form = new FormData();
		const writes = body.writes ?? [];
		form.append(
			"revision",
			JSON.stringify({ ...body.meta, writes: writes.map((w) => w.path) }),
		);
		for (const w of writes)
			form.append("files", new Blob([new TextEncoder().encode(w.content)]));
		init.body = form;
	}
	return { init, authed };
}

let distRoot: string;

beforeAll(() => {
	resetDependencies();
	// Materialize the fixed resources under a throwaway distribution root and
	// register them in the manifest the resolver reads.
	distRoot = fs.mkdtempSync(path.join(os.tmpdir(), "preview-contract-dist-"));
	const resources: Record<string, { path: string; size: number }> = {};
	for (const [id, entry] of Object.entries(VECTORS.fixedResources)) {
		const full = path.join(distRoot, entry.path);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, entry.content);
		resources[id] = { path: entry.path, size: byteLength(entry.content) };
	}
	const bundles = path.join(distRoot, "bundles");
	fs.mkdirSync(bundles, { recursive: true });
	const manifestPath = path.join(bundles, "preview-fixed-resources.json");
	fs.writeFileSync(
		manifestPath,
		JSON.stringify({
			schemaVersion: 1,
			buildVersion: "conformance",
			resources,
		}),
	);
	fixedResources.configure({ distRoot, manifestPath });
});

afterAll(() => {
	resetDependencies();
	fixedResources.resetDependencies();
	fs.rmSync(distRoot, { recursive: true, force: true });
});

describe("preview serving contract v2 — conformance vectors", () => {
	test("advertises protocol version 2", () => {
		expect(VECTORS.protocolVersion).toBe(2);
	});

	// The whole sequence is ONE session and MUST run in order: replay it inside a
	// single test, capturing the previewId from create-session and substituting it
	// into every later step's path.
	test("replays every step in order against one session", async () => {
		let previewId = "";

		for (const step of VECTORS.steps) {
			const substituted: VectorStep = JSON.parse(
				JSON.stringify(step).replaceAll("{previewId}", previewId),
			);
			const { init, authed } = buildRequestInit(substituted);
			const res = await (authed ? ownerApp : anonApp).request(
				toAppPath(substituted.request.path),
				init,
			);

			// Assert against `substituted.expect` — its values already have
			// `{previewId}` replaced, which matters for header expectations like the
			// bare-root redirect's relative `Location: {previewId}/index.html`.
			expect(res.status, `status for step "${step.id}"`).toBe(
				substituted.expect.status,
			);
			if (substituted.expect.headers)
				expectHeaders(res, substituted.expect.headers);

			// Read the body at most once, then run every body-shaped assertion off it.
			const needsBody =
				substituted.expect.bodyText !== undefined ||
				substituted.expect.body !== undefined;
			const isCreate = step.id === "create-session";
			if (needsBody || isCreate) {
				const text = await res.text();
				if (substituted.expect.bodyText !== undefined)
					expect(text, `bodyText for step "${step.id}"`).toBe(
						substituted.expect.bodyText,
					);
				if (substituted.expect.body !== undefined || isCreate) {
					const json = JSON.parse(text);
					if (substituted.expect.body !== undefined)
						expectBodySubset(json, substituted.expect.body);
					if (isCreate) {
						previewId = json.previewId as string;
						expect(previewId).toMatch(
							/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
						);
					}
				}
			}
		}
	});
});
