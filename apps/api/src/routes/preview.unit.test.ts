import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import * as fixedResources from "../services/preview-fixed-resources.ts";
import {
	configure,
	resetDependencies,
} from "../services/preview-session-store.ts";
import {
	PROTOCOL_VERSION,
	previewRoutes,
	previewSessionRoutes,
	RECOMMENDED_BATCH_BYTES,
} from "./preview.ts";

const OWNER = {
	id: "owner-1",
	role: "author",
	email: "owner@test.local",
	name: "Owner",
};
const OTHER = {
	id: "other-2",
	role: "author",
	email: "other@test.local",
	name: "Other",
};
const UNKNOWN_ID = "11111111-2222-4333-8444-555555555555";
const KEY_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeffff0000@9c41d2e8a1b03f57";
const KEY_B = "12345678-90ab-4cde-8f01-234567890abc@00112233";

// Byte-identical to eXe core previewCspHeader(). Assert the WHOLE string so a
// mutated middle directive is caught, not just the sandbox prefix.
const EXPECTED_PREVIEW_CSP =
	"sandbox allow-scripts allow-popups allow-forms; default-src 'self'; " +
	"script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; " +
	"font-src 'self' data:; connect-src 'self'; " +
	"frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com; " +
	"child-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com; " +
	"object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";

function bytesOf(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

/**
 * Build a test app with session auth mocked to `mockUser`, mounting both the
 * owner-gated management API and the authless serving route on the real paths.
 * All apps share the process-local store singleton, so a session created via
 * one app is visible to another (that is how cross-owner 403s are exercised).
 */
function createPreviewApp(mockUser: Record<string, unknown> | null) {
	const app = new Hono<AuthEnv>();
	app.use("*", async (c, next) => {
		c.set("user", mockUser as AuthEnv["Variables"]["user"]);
		c.set(
			"session",
			mockUser
				? ({ id: "test-session" } as AuthEnv["Variables"]["session"])
				: null,
		);
		await next();
	});
	app.route("/api/v1/preview-session", previewSessionRoutes);
	app.route("/api/v1/preview", previewRoutes);
	return app;
}

const ownerApp = createPreviewApp(OWNER);
const otherApp = createPreviewApp(OTHER);
const anonApp = createPreviewApp(null);

async function createViaApi(app = ownerApp): Promise<string> {
	const res = await app.request("/api/v1/preview-session", { method: "POST" });
	expect(res.status).toBe(201);
	return ((await res.json()) as { previewId: string }).previewId;
}

/** Upload session assets. `entries` are `{ key, content }`; declared size is byte length. */
async function uploadAssets(
	previewId: string,
	entries: Array<{ key: string; content: string }>,
	app = ownerApp,
): Promise<Response> {
	const form = new FormData();
	form.append(
		"assets",
		JSON.stringify(
			entries.map((e) => ({ key: e.key, size: bytesOf(e.content).length })),
		),
	);
	for (const e of entries) form.append("files", new Blob([bytesOf(e.content)]));
	return app.request(`/api/v1/preview-session/${previewId}/assets`, {
		method: "POST",
		body: form,
	});
}

/** Publish a revision. `writes` are `{ path, content }`, index-aligned with the `files` parts. */
async function publishRevision(
	previewId: string,
	meta: {
		baseRevision: number;
		nextRevision: number;
		writes?: Array<{ path: string; content: string }>;
		deletes?: string[];
		assetRefs?: Record<string, string>;
		fixedRefs?: Record<string, string>;
	},
	app = ownerApp,
): Promise<Response> {
	const writes = meta.writes ?? [];
	const form = new FormData();
	form.append(
		"revision",
		JSON.stringify({
			baseRevision: meta.baseRevision,
			nextRevision: meta.nextRevision,
			writes: writes.map((w) => w.path),
			deletes: meta.deletes ?? [],
			assetRefs: meta.assetRefs ?? {},
			fixedRefs: meta.fixedRefs ?? {},
		}),
	);
	for (const w of writes) form.append("files", new Blob([bytesOf(w.content)]));
	return app.request(`/api/v1/preview-session/${previewId}/revisions`, {
		method: "POST",
		body: form,
	});
}

beforeEach(() => {
	resetDependencies();
	fixedResources.resetDependencies();
});

afterEach(() => {
	resetDependencies();
	fixedResources.resetDependencies();
});

describe("POST /api/v1/preview-session", () => {
	test("requires authentication", async () => {
		expect(
			(await anonApp.request("/api/v1/preview-session", { method: "POST" }))
				.status,
		).toBe(401);
	});

	test("creates a session and advertises protocol v2, revision 0, and the limits", async () => {
		const res = await ownerApp.request("/api/v1/preview-session", {
			method: "POST",
		});
		expect(res.status).toBe(201);
		const json = (await res.json()) as {
			previewId: string;
			protocolVersion: number;
			revision: number;
			limits: {
				maxFilesPerSession: number;
				maxBytesPerSession: number;
				maxAssetBytes: number;
				recommendedBatchBytes: number;
			};
		};
		expect(json.previewId).toMatch(/^[0-9a-f-]{36}$/);
		expect(json.protocolVersion).toBe(PROTOCOL_VERSION);
		expect(json.protocolVersion).toBe(2);
		expect(json.revision).toBe(0);
		expect(json.limits.maxFilesPerSession).toBeGreaterThan(0);
		expect(json.limits.maxBytesPerSession).toBeGreaterThan(0);
		expect(json.limits.maxAssetBytes).toBeGreaterThan(0);
		expect(json.limits.recommendedBatchBytes).toBe(RECOMMENDED_BATCH_BYTES);
	});
});

describe("POST /api/v1/preview-session/:previewId/assets", () => {
	test("enforces auth, ownership and existence", async () => {
		const previewId = await createViaApi();
		expect(
			(await uploadAssets(previewId, [{ key: KEY_A, content: "x" }], anonApp))
				.status,
		).toBe(401);
		expect(
			(await uploadAssets(previewId, [{ key: KEY_A, content: "x" }], otherApp))
				.status,
		).toBe(403);
		expect(
			(await uploadAssets(UNKNOWN_ID, [{ key: KEY_A, content: "x" }], ownerApp))
				.status,
		).toBe(404);
	});

	test("stores assets and reports immutable re-uploads as alreadyStored", async () => {
		const previewId = await createViaApi();
		const first = await uploadAssets(previewId, [
			{ key: KEY_A, content: "PHOTO-v1" },
		]);
		expect(first.status).toBe(200);
		expect(await first.json()).toEqual({
			stored: [KEY_A],
			alreadyStored: [],
			rejected: [],
		});

		const second = await uploadAssets(previewId, [
			{ key: KEY_A, content: "PHOTO-v2-DIFFERENT" },
		]);
		expect(await second.json()).toEqual({
			stored: [],
			alreadyStored: [KEY_A],
			rejected: [],
		});
	});

	test("rejects malformed assets JSON, non-array entries, and count mismatch with 400", async () => {
		const previewId = await createViaApi();
		const badJson = new FormData();
		badJson.append("assets", "not json");
		badJson.append("files", new Blob([bytesOf("x")]));
		expect(
			(
				await ownerApp.request(`/api/v1/preview-session/${previewId}/assets`, {
					method: "POST",
					body: badJson,
				})
			).status,
		).toBe(400);

		const notArray = new FormData();
		notArray.append("assets", JSON.stringify({ nope: true }));
		expect(
			(
				await ownerApp.request(`/api/v1/preview-session/${previewId}/assets`, {
					method: "POST",
					body: notArray,
				})
			).status,
		).toBe(400);

		const misaligned = new FormData();
		misaligned.append("assets", JSON.stringify([{ key: KEY_A, size: 1 }]));
		// No files → count mismatch.
		expect(
			(
				await ownerApp.request(`/api/v1/preview-session/${previewId}/assets`, {
					method: "POST",
					body: misaligned,
				})
			).status,
		).toBe(400);
	});

	test("rejects the batch on the declared-size budget before buffering (413)", async () => {
		configure({
			limits: {
				ttlMs: 1e9,
				maxSessionsPerUser: 4,
				maxFilesPerSession: 5000,
				maxBytesPerSession: 4,
				maxAssetBytes: 1e9,
				globalMaxBytes: 1e9,
				sweepIntervalMs: 60000,
			},
		});
		const previewId = await createViaApi();
		expect(
			(await uploadAssets(previewId, [{ key: KEY_A, content: "12345" }]))
				.status,
		).toBe(413);
	});

	test("rejects the batch when the ACTUAL bytes overrun the budget (413)", async () => {
		configure({
			limits: {
				ttlMs: 1e9,
				maxSessionsPerUser: 4,
				maxFilesPerSession: 5000,
				maxBytesPerSession: 4,
				maxAssetBytes: 1e9,
				globalMaxBytes: 1e9,
				sweepIntervalMs: 60000,
			},
		});
		const previewId = await createViaApi();
		// Declared size 3 passes stage one; the real blob is 5 bytes → stage two 413.
		const form = new FormData();
		form.append("assets", JSON.stringify([{ key: KEY_A, size: 3 }]));
		form.append("files", new Blob([bytesOf("12345")]));
		expect(
			(
				await ownerApp.request(`/api/v1/preview-session/${previewId}/assets`, {
					method: "POST",
					body: form,
				})
			).status,
		).toBe(413);
	});

	test("surfaces per-entry rejections (invalid key) from the store", async () => {
		const previewId = await createViaApi();
		const res = await uploadAssets(previewId, [
			{ key: "bad-key", content: "x" },
		]);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			stored: [],
			alreadyStored: [],
			rejected: [{ key: "bad-key", reason: "invalid-key" }],
		});
	});
});

describe("POST /api/v1/preview-session/:previewId/revisions", () => {
	test("enforces auth and ownership", async () => {
		const previewId = await createViaApi();
		expect(
			(
				await publishRevision(
					previewId,
					{
						baseRevision: 0,
						nextRevision: 1,
						writes: [{ path: "index.html", content: "x" }],
					},
					anonApp,
				)
			).status,
		).toBe(401);
		expect(
			(
				await publishRevision(
					previewId,
					{
						baseRevision: 0,
						nextRevision: 1,
						writes: [{ path: "index.html", content: "x" }],
					},
					otherApp,
				)
			).status,
		).toBe(403);
		expect(
			(
				await publishRevision(UNKNOWN_ID, {
					baseRevision: 0,
					nextRevision: 1,
					writes: [{ path: "index.html", content: "x" }],
				})
			).status,
		).toBe(404);
	});

	test("publishes the first revision and serves it", async () => {
		const previewId = await createViaApi();
		const res = await publishRevision(previewId, {
			baseRevision: 0,
			nextRevision: 1,
			writes: [{ path: "index.html", content: "hello" }],
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ revision: 1, active: true });
		const served = await anonApp.request(
			`/api/v1/preview/${previewId}/index.html`,
		);
		expect(await served.text()).toBe("hello");
	});

	test("rejects malformed revision bodies with 400", async () => {
		const previewId = await createViaApi();
		const req = async (revision: unknown, appendFiles = 0) => {
			const form = new FormData();
			form.append(
				"revision",
				typeof revision === "string" ? revision : JSON.stringify(revision),
			);
			for (let i = 0; i < appendFiles; i++)
				form.append("files", new Blob([bytesOf("x")]));
			return ownerApp.request(
				`/api/v1/preview-session/${previewId}/revisions`,
				{ method: "POST", body: form },
			);
		};
		expect((await req("not json")).status).toBe(400);
		expect((await req([1, 2, 3])).status).toBe(400);
		expect((await req({ baseRevision: "0", nextRevision: 1 })).status).toBe(
			400,
		);
		expect(
			(await req({ baseRevision: 0, nextRevision: 1, writes: [1] })).status,
		).toBe(400);
		expect(
			(await req({ baseRevision: 0, nextRevision: 1, deletes: [1] })).status,
		).toBe(400);
		expect(
			(
				await req({
					baseRevision: 0,
					nextRevision: 1,
					assetRefs: { "a.png": 5 },
				})
			).status,
		).toBe(400);
		// writes has one path but no file parts → count mismatch.
		expect(
			(await req({ baseRevision: 0, nextRevision: 1, writes: ["index.html"] }))
				.status,
		).toBe(400);
	});

	test("returns 409 revision-conflict with the current revision on a stale base", async () => {
		const previewId = await createViaApi();
		await publishRevision(previewId, {
			baseRevision: 0,
			nextRevision: 1,
			writes: [{ path: "index.html", content: "v1" }],
		});
		const conflict = await publishRevision(previewId, {
			baseRevision: 0,
			nextRevision: 1,
			writes: [{ path: "index.html", content: "stale" }],
		});
		expect(conflict.status).toBe(409);
		expect(await conflict.json()).toEqual({
			reason: "revision-conflict",
			currentRevision: 1,
		});
	});

	test("returns 422 missing-assets when a revision references an unstored asset", async () => {
		const previewId = await createViaApi();
		const res = await publishRevision(previewId, {
			baseRevision: 0,
			nextRevision: 1,
			assetRefs: { "content/ghost.png": KEY_A },
		});
		expect(res.status).toBe(422);
		expect(await res.json()).toEqual({
			reason: "missing-assets",
			missing: [KEY_A],
		});
	});

	test("returns 422 unknown-fixed-resources when a revision references an unlisted fixed id", async () => {
		const previewId = await createViaApi();
		const res = await publishRevision(previewId, {
			baseRevision: 0,
			nextRevision: 1,
			fixedRefs: { "libs/x.js": "libs/does-not-exist" },
		});
		expect(res.status).toBe(422);
		expect(await res.json()).toEqual({
			reason: "unknown-fixed-resources",
			resources: ["libs/does-not-exist"],
		});
	});

	test("rejects a revision whose document payload overruns the byte budget with 413", async () => {
		configure({
			limits: {
				ttlMs: 1e9,
				maxSessionsPerUser: 4,
				maxFilesPerSession: 5000,
				maxBytesPerSession: 3,
				maxAssetBytes: 1e9,
				globalMaxBytes: 1e9,
				sweepIntervalMs: 60000,
			},
		});
		const previewId = await createViaApi();
		const res = await publishRevision(previewId, {
			baseRevision: 0,
			nextRevision: 1,
			writes: [{ path: "a.html", content: "1234" }],
		});
		expect(res.status).toBe(413);
	});

	test("passes an unsafe write path through to the store, surfacing its 400", async () => {
		const previewId = await createViaApi();
		// The route accepts the shape (writes is a string array aligned with files);
		// the store's path normalization is what rejects `../escape.html` with 400.
		const res = await publishRevision(previewId, {
			baseRevision: 0,
			nextRevision: 1,
			writes: [{ path: "../escape.html", content: "x" }],
		});
		expect(res.status).toBe(400);
		expect((await res.json()) as { error: string }).toHaveProperty("error");
	});
});

describe("DELETE /api/v1/preview-session/:previewId", () => {
	test("enforces auth and ownership, then deletes", async () => {
		const previewId = await createViaApi();
		expect(
			(
				await anonApp.request(`/api/v1/preview-session/${previewId}`, {
					method: "DELETE",
				})
			).status,
		).toBe(401);
		expect(
			(
				await otherApp.request(`/api/v1/preview-session/${previewId}`, {
					method: "DELETE",
				})
			).status,
		).toBe(403);
		const ok = await ownerApp.request(`/api/v1/preview-session/${previewId}`, {
			method: "DELETE",
		});
		expect(ok.status).toBe(200);
		expect(await ok.json()).toEqual({ success: true });
		expect(
			(
				await ownerApp.request(`/api/v1/preview-session/${previewId}`, {
					method: "DELETE",
				})
			).status,
		).toBe(404);
	});
});

describe("GET /api/v1/preview/:previewId/* (authless serving)", () => {
	/** Publish a one-revision session serving the given documents. */
	async function servedSession(
		documents: Record<string, string>,
	): Promise<string> {
		const previewId = await createViaApi();
		const res = await publishRevision(previewId, {
			baseRevision: 0,
			nextRevision: 1,
			writes: Object.entries(documents).map(([path, content]) => ({
				path,
				content,
			})),
		});
		expect(res.status).toBe(200);
		return previewId;
	}

	test("serves documents with correct MIME types (no auth required)", async () => {
		const previewId = await servedSession({
			"index.html": "<html><body>hi</body></html>",
			"theme/style.css": "body { color: red; }",
			"libs/app.js": "console.log(1);",
			"img/v.svg": "<svg/>",
		});
		const cases: Array<[string, string]> = [
			["index.html", "text/html; charset=utf-8"],
			["theme/style.css", "text/css; charset=utf-8"],
			["libs/app.js", "application/javascript; charset=utf-8"],
			["img/v.svg", "image/svg+xml; charset=utf-8"],
		];
		for (const [p, mime] of cases) {
			const res = await anonApp.request(`/api/v1/preview/${previewId}/${p}`);
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toBe(mime);
		}
	});

	test("emits the hardening headers on every response, including 404s, with tiered Cache-Control", async () => {
		const previewId = await servedSession({ "index.html": "<html></html>" });
		const ok = await ownerApp.request(
			`/api/v1/preview/${previewId}/index.html`,
		);
		const missing = await ownerApp.request(
			`/api/v1/preview/${previewId}/missing.css`,
		);
		const unknownSession = await ownerApp.request(
			`/api/v1/preview/${UNKNOWN_ID}/index.html`,
		);
		expect(missing.status).toBe(404);
		expect(unknownSession.status).toBe(404);
		for (const res of [ok, missing, unknownSession]) {
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
			expect(res.headers.get("referrer-policy")).toBe("no-referrer");
			expect(res.headers.get("permissions-policy")).toContain("camera=()");
			expect(res.headers.get("access-control-allow-origin")).toBe("*");
		}
		// Documents and 404s are no-store.
		expect(ok.headers.get("cache-control")).toBe("no-store");
		expect(missing.headers.get("cache-control")).toBe("no-store");
		expect(unknownSession.headers.get("cache-control")).toBe("no-store");
	});

	test("adds the byte-identical sandbox CSP to every scriptable type and to none of the passive ones", async () => {
		const previewId = await servedSession({
			"index.html": "<html></html>",
			"html/page2.html": "<html>2</html>",
			"img/logo.svg":
				'<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>',
			"data/feed.xml": '<?xml version="1.0"?><root/>',
			"theme/style.css": "body{}",
			"libs/app.js": "console.log(1);",
			"img/i.png": "binarypng",
		});
		for (const scriptable of [
			"index.html",
			"html/page2.html",
			"img/logo.svg",
			"data/feed.xml",
		]) {
			const res = await ownerApp.request(
				`/api/v1/preview/${previewId}/${scriptable}`,
			);
			const csp = res.headers.get("content-security-policy") ?? "";
			expect(csp).toBe(EXPECTED_PREVIEW_CSP);
			expect(csp).not.toContain("allow-same-origin");
		}
		for (const passive of ["theme/style.css", "libs/app.js", "img/i.png"]) {
			const res = await ownerApp.request(
				`/api/v1/preview/${previewId}/${passive}`,
			);
			expect(res.headers.get("content-security-policy")).toBeNull();
		}
	});

	test("redirects the bare session URL (and trailing slash) to index.html (302)", async () => {
		const previewId = await servedSession({
			"index.html": "<html>root</html>",
		});
		// Contract v2 §4: the bare capability URL must 302 to …/{previewId}/index.html
		// so the iframe's relative-URL base is always …/{previewId}/ — never serve
		// index bytes from the bare path. The absolute-path Location must resolve to
		// the same target from both the no-slash and trailing-slash forms.
		for (const suffix of ["", "/"]) {
			const res = await ownerApp.request(
				`/api/v1/preview/${previewId}${suffix}`,
				{ redirect: "manual" },
			);
			expect(res.status).toBe(302);
			expect(res.headers.get("location")).toBe(
				`/api/v1/preview/${previewId}/index.html`,
			);
			// Hardening headers ride even the redirect; the redirect is never cached.
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
			expect(res.headers.get("cache-control")).toBe("no-store");
			// The bare URL must not leak the document bytes.
			expect(await res.text()).toBe("");
		}
	});

	test("rejects traversal attempts and malformed ids with 404", async () => {
		const previewId = await servedSession({ "index.html": "<html></html>" });
		const paths = [
			`/api/v1/preview/${previewId}/%2e%2e/secret`,
			`/api/v1/preview/${previewId}/%2e%2e%2fsecret`,
			`/api/v1/preview/${previewId}/a%2f..%2f..%2fsecret`,
			`/api/v1/preview/${previewId}/%00`,
			`/api/v1/preview/not-a-uuid/index.html`,
		];
		for (const p of paths) {
			expect((await ownerApp.request(p)).status).toBe(404);
		}
	});

	test("resolves the relative path even when a hex char of the id segment is percent-encoded", async () => {
		const previewId = await servedSession({
			"index.html": "<html>root</html>",
			"html/page.html": "<html>deep</html>",
		});
		// Percent-encode the first hex char of the (valid, existing) id so the raw id
		// segment differs from the server-decoded id. The relPath derivation must not
		// desync: the request has to serve the SAME file as the un-encoded id.
		const encodedId = `%${previewId.charCodeAt(0).toString(16)}${previewId.slice(1)}`;
		expect(encodedId).not.toBe(previewId);

		const rootPlain = await anonApp.request(
			`/api/v1/preview/${previewId}/index.html`,
		);
		const rootEncoded = await anonApp.request(
			`/api/v1/preview/${encodedId}/index.html`,
		);
		expect(rootEncoded.status).toBe(200);
		expect(await rootEncoded.text()).toBe(await rootPlain.text());

		// A nested relPath must survive the encoded id segment too.
		const deep = await anonApp.request(
			`/api/v1/preview/${encodedId}/html/page.html`,
		);
		expect(deep.status).toBe(200);
		expect(await deep.text()).toBe("<html>deep</html>");
	});

	test("serves nothing until the first revision publishes (revision 0)", async () => {
		const previewId = await createViaApi();
		const res = await anonApp.request(
			`/api/v1/preview/${previewId}/index.html`,
		);
		expect(res.status).toBe(404);
		expect(res.headers.get("cache-control")).toBe("no-store");
	});

	test("returns 404 after the session is deleted", async () => {
		const previewId = await servedSession({ "index.html": "x" });
		expect(
			(
				await ownerApp.request(`/api/v1/preview-session/${previewId}`, {
					method: "DELETE",
				})
			).status,
		).toBe(200);
		expect(
			(await ownerApp.request(`/api/v1/preview/${previewId}/index.html`))
				.status,
		).toBe(404);
	});

	test("serves updated bytes after a revision refresh and keeps unchanged paths", async () => {
		const previewId = await servedSession({
			"index.html": "version one",
			"theme/style.css": "unchanged css",
		});
		const refresh = await publishRevision(previewId, {
			baseRevision: 1,
			nextRevision: 2,
			writes: [{ path: "index.html", content: "version two!" }],
		});
		expect(refresh.status).toBe(200);
		expect(
			await (
				await ownerApp.request(`/api/v1/preview/${previewId}/index.html`)
			).text(),
		).toBe("version two!");
		// writes/deletes are DELTAS: an untouched, undeleted document keeps serving
		// across revisions (no full re-upload).
		const css = await ownerApp.request(
			`/api/v1/preview/${previewId}/theme/style.css`,
		);
		expect(css.status).toBe(200);
		expect(await css.text()).toBe("unchanged css");
	});
});

describe("GET /api/v1/preview asset tier (ETag / Range)", () => {
	async function sessionWithAsset(
		servedPath: string,
		key: string,
		content: string,
	): Promise<string> {
		const previewId = await createViaApi();
		expect((await uploadAssets(previewId, [{ key, content }])).status).toBe(
			200,
		);
		expect(
			(
				await publishRevision(previewId, {
					baseRevision: 0,
					nextRevision: 1,
					assetRefs: { [servedPath]: key },
				})
			).status,
		).toBe(200);
		return previewId;
	}

	test("serves assets with the revalidating tier: no-cache, ETag, Accept-Ranges", async () => {
		const previewId = await sessionWithAsset(
			"content/photo.png",
			KEY_A,
			"PHOTO-BYTES",
		);
		const res = await anonApp.request(
			`/api/v1/preview/${previewId}/content/photo.png`,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("image/png");
		expect(res.headers.get("cache-control")).toBe("no-cache");
		expect(res.headers.get("etag")).toBe(`"${KEY_A}"`);
		expect(res.headers.get("accept-ranges")).toBe("bytes");
		expect(res.headers.get("content-security-policy")).toBeNull();
		expect(await res.text()).toBe("PHOTO-BYTES");
	});

	test("answers If-None-Match with 304 when the ETag matches", async () => {
		const previewId = await sessionWithAsset(
			"content/photo.png",
			KEY_A,
			"PHOTO-BYTES",
		);
		const res = await anonApp.request(
			`/api/v1/preview/${previewId}/content/photo.png`,
			{
				headers: { "If-None-Match": `"${KEY_A}"` },
			},
		);
		expect(res.status).toBe(304);
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
	});

	test("serves a satisfiable single range as 206 with Content-Range", async () => {
		const previewId = await sessionWithAsset(
			"media/clip.mp4",
			KEY_B,
			"0123456789",
		);
		const res = await anonApp.request(
			`/api/v1/preview/${previewId}/media/clip.mp4`,
			{
				headers: { Range: "bytes=2-4" },
			},
		);
		expect(res.status).toBe(206);
		expect(res.headers.get("content-range")).toBe("bytes 2-4/10");
		expect(res.headers.get("content-length")).toBe("3");
		expect(await res.text()).toBe("234");
	});

	test("serves a suffix range (last N bytes) as 206", async () => {
		const previewId = await sessionWithAsset(
			"media/clip.mp4",
			KEY_B,
			"0123456789",
		);
		const res = await anonApp.request(
			`/api/v1/preview/${previewId}/media/clip.mp4`,
			{
				headers: { Range: "bytes=-3" },
			},
		);
		expect(res.status).toBe(206);
		expect(res.headers.get("content-range")).toBe("bytes 7-9/10");
		expect(await res.text()).toBe("789");
	});

	// Contract v2 §4: 416 is ONLY for a VALID single unsatisfiable range —
	// first-byte-pos at/past EOF, or a zero-length suffix (bytes=-0).
	test("answers a valid unsatisfiable range with 416", async () => {
		const previewId = await sessionWithAsset(
			"media/clip.mp4",
			KEY_B,
			"0123456789",
		);
		for (const range of ["bytes=99-", "bytes=-0"]) {
			const res = await anonApp.request(
				`/api/v1/preview/${previewId}/media/clip.mp4`,
				{ headers: { Range: range } },
			);
			expect(res.status, `Range: ${range}`).toBe(416);
			expect(res.headers.get("content-range")).toBe("bytes */10");
		}
	});

	// Contract v2 §4: malformed / multi-range / non-bytes-unit Range headers, AND
	// an INVALID single range (last-byte-pos < first-byte-pos, RFC 9110), are
	// IGNORED — a normal 200 full response, not a 416.
	test("ignores unhonored Range headers and serves the full 200 body", async () => {
		const previewId = await sessionWithAsset(
			"media/clip.mp4",
			KEY_B,
			"0123456789",
		);
		const ignored = [
			"bytes=0-1,3-4", // multi-range list
			"items=0-4", // non-bytes unit
			"bytes=abc", // malformed
			"bytes=-", // no first-byte-pos and no suffix-length
			"kittens", // pure garbage
			"bytes=5-2", // last < first: invalid spec → ignore (NOT 416)
			"bytes=15-2", // invalid spec beats out-of-range: ignore (NOT 416)
		];
		for (const range of ignored) {
			const res = await anonApp.request(
				`/api/v1/preview/${previewId}/media/clip.mp4`,
				{ headers: { Range: range } },
			);
			expect(res.status, `Range: ${range}`).toBe(200);
			expect(res.headers.get("content-range")).toBeNull();
			expect(await res.text()).toBe("0123456789");
		}
	});
});

describe("GET /api/v1/preview fixed tier (manifest-gated layer 1)", () => {
	let distRoot: string;

	beforeEach(() => {
		distRoot = fs.mkdtempSync(path.join(os.tmpdir(), "preview-route-fixed-"));
		const bundles = path.join(distRoot, "bundles");
		fs.mkdirSync(bundles, { recursive: true });
		fs.mkdirSync(path.join(distRoot, "libs", "jquery"), { recursive: true });
		fs.mkdirSync(
			path.join(distRoot, "files", "perm", "themes", "base", "base"),
			{ recursive: true },
		);
		fs.writeFileSync(
			path.join(distRoot, "libs", "jquery", "jquery.min.js"),
			"window.jQuery=function(){};",
		);
		fs.writeFileSync(
			path.join(
				distRoot,
				"files",
				"perm",
				"themes",
				"base",
				"base",
				"icon.svg",
			),
			'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
		);
		fs.writeFileSync(
			path.join(bundles, "preview-fixed-resources.json"),
			JSON.stringify({
				schemaVersion: 1,
				buildVersion: "test",
				resources: {
					"libs/jquery/jquery.min.js": {
						path: "libs/jquery/jquery.min.js",
						size: 27,
					},
					"theme:base/icon.svg": {
						path: "files/perm/themes/base/base/icon.svg",
						size: 71,
					},
				},
			}),
		);
		fixedResources.configure({
			distRoot,
			manifestPath: path.join(bundles, "preview-fixed-resources.json"),
		});
	});

	afterEach(() => {
		fs.rmSync(distRoot, { recursive: true, force: true });
	});

	test("serves a manifest-listed fixed resource with the immutable cache tier", async () => {
		const previewId = await createViaApi();
		expect(
			(
				await publishRevision(previewId, {
					baseRevision: 0,
					nextRevision: 1,
					fixedRefs: {
						"libs/jquery/jquery.min.js": "libs/jquery/jquery.min.js",
					},
				})
			).status,
		).toBe(200);
		const res = await anonApp.request(
			`/api/v1/preview/${previewId}/libs/jquery/jquery.min.js`,
		);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("window.jQuery=function(){};");
		expect(res.headers.get("cache-control")).toBe("private, max-age=31536000");
		expect(res.headers.get("access-control-allow-origin")).toBe("*");
	});

	test("emits the sandbox CSP on a scriptable SVG served from the fixed layer", async () => {
		const previewId = await createViaApi();
		await publishRevision(previewId, {
			baseRevision: 0,
			nextRevision: 1,
			fixedRefs: { "theme/icon.svg": "theme:base/icon.svg" },
		});
		const res = await anonApp.request(
			`/api/v1/preview/${previewId}/theme/icon.svg`,
		);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe(
			"image/svg+xml; charset=utf-8",
		);
		expect(res.headers.get("cache-control")).toBe("private, max-age=31536000");
		expect(res.headers.get("content-security-policy")).toBe(
			EXPECTED_PREVIEW_CSP,
		);
	});
});
