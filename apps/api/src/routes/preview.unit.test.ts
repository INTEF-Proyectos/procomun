import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import {
	configure,
	resetDependencies,
} from "../services/preview-snapshot-store.ts";
import { buildSimpleZip } from "../services/preview-snapshot-test-zip.ts";
import { previewRoutes, previewSessionRoutes } from "./preview.ts";

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

/**
 * Build a test app with session auth mocked to `mockUser`, mounting both the
 * owner-gated management API and the authless serving route on the real paths.
 * All apps share the process-local store singleton, so a snapshot published via
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

/** POST a snapshot archive built from `files`. */
async function postSnapshot(
	files: Record<string, string>,
	options: { previewId?: string; app?: Hono<AuthEnv> } = {},
): Promise<Response> {
	const app = options.app ?? ownerApp;
	const zip = await buildSimpleZip(files);
	// Copy into an owned ArrayBuffer: BlobPart does not accept
	// Uint8Array<ArrayBufferLike> under the repo's strict TS lib.
	const body = new Uint8Array(zip.byteLength);
	body.set(zip);
	const form = new FormData();
	form.append("snapshot", new Blob([body]), "preview.zip");
	if (options.previewId !== undefined) {
		form.append("previewId", options.previewId);
	}
	return app.request("/api/v1/preview-session", { method: "POST", body: form });
}

/** Publish a snapshot and return its capability id. */
async function servedSnapshot(files: Record<string, string>): Promise<string> {
	const res = await postSnapshot(files);
	expect(res.status).toBe(200);
	return ((await res.json()) as { previewId: string }).previewId;
}

beforeEach(() => {
	resetDependencies();
});

afterEach(() => {
	resetDependencies();
});

describe("POST /api/v1/preview-session", () => {
	test("requires authentication", async () => {
		const res = await postSnapshot({ "index.html": "x" }, { app: anonApp });
		expect(res.status).toBe(401);
	});

	test("publishes a snapshot and returns a capability id", async () => {
		const res = await postSnapshot({ "index.html": "<html>hi</html>" });

		expect(res.status).toBe(200);
		const body = (await res.json()) as { previewId: string };
		expect(body.previewId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
		);
		// No previewUrl on the wire: the client derives it from servingBaseUrl.
		expect(body).not.toHaveProperty("previewUrl");
	});

	test("replaces in place when given a previewId", async () => {
		const previewId = await servedSnapshot({ "index.html": "first" });

		const res = await postSnapshot({ "index.html": "second" }, { previewId });

		expect(res.status).toBe(200);
		expect(((await res.json()) as { previewId: string }).previewId).toBe(
			previewId,
		);
		const served = await anonApp.request(
			`/api/v1/preview/${previewId}/index.html`,
		);
		expect(await served.text()).toBe("second");
	});

	test("rejects a request without a snapshot file", async () => {
		const res = await ownerApp.request("/api/v1/preview-session", {
			method: "POST",
			body: new FormData(),
		});
		expect(res.status).toBe(400);
	});

	test("rejects a malformed previewId before touching the store", async () => {
		const res = await postSnapshot(
			{ "index.html": "x" },
			{ previewId: "not-a-uuid" },
		);
		expect(res.status).toBe(400);
	});

	test("refuses another user's capability with 403", async () => {
		const previewId = await servedSnapshot({ "index.html": "hers" });

		const res = await postSnapshot(
			{ "index.html": "theirs" },
			{ previewId, app: otherApp },
		);

		expect(res.status).toBe(403);
		const served = await anonApp.request(
			`/api/v1/preview/${previewId}/index.html`,
		);
		expect(await served.text()).toBe("hers");
	});

	test("returns 404 for an unknown capability", async () => {
		const res = await postSnapshot(
			{ "index.html": "x" },
			{ previewId: UNKNOWN_ID },
		);
		expect(res.status).toBe(404);
	});

	test("surfaces an archive rejection as 400", async () => {
		const res = await postSnapshot({ "page.html": "no index" });
		expect(res.status).toBe(400);
	});

	test("surfaces an over-budget archive as 413", async () => {
		configure({
			limits: {
				ttlMs: 30 * 60 * 1000,
				maxSnapshotsPerUser: 4,
				maxFilesPerSnapshot: 5000,
				maxBytesPerSnapshot: 16,
				globalMaxBytes: 2048 * 1024 * 1024,
				sweepIntervalMs: 60 * 1000,
			},
		});

		const res = await postSnapshot({ "index.html": "x".repeat(1024) });

		expect(res.status).toBe(413);
	});
});

describe("DELETE /api/v1/preview-session/:previewId", () => {
	test("enforces auth and ownership, then deletes", async () => {
		const previewId = await servedSnapshot({ "index.html": "<html></html>" });

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
		expect(
			(
				await ownerApp.request(`/api/v1/preview-session/${UNKNOWN_ID}`, {
					method: "DELETE",
				})
			).status,
		).toBe(404);

		const res = await ownerApp.request(`/api/v1/preview-session/${previewId}`, {
			method: "DELETE",
		});
		expect(res.status).toBe(200);
		expect(
			(await anonApp.request(`/api/v1/preview/${previewId}/index.html`)).status,
		).toBe(404);
	});
});

describe("GET /api/v1/preview/:previewId/* (authless serving)", () => {
	test("serves documents with correct MIME types (no auth required)", async () => {
		const previewId = await servedSnapshot({
			"index.html": "<html>root</html>",
			"style/main.css": "body{}",
			"script/app.js": "run()",
			"img/photo.png": "PNGDATA",
		});

		const cases: Array<[string, string, string]> = [
			["index.html", "text/html; charset=utf-8", "<html>root</html>"],
			["style/main.css", "text/css; charset=utf-8", "body{}"],
			["script/app.js", "application/javascript; charset=utf-8", "run()"],
			["img/photo.png", "image/png", "PNGDATA"],
		];
		for (const [rel, contentType, body] of cases) {
			const res = await anonApp.request(`/api/v1/preview/${previewId}/${rel}`);
			expect(res.status, rel).toBe(200);
			expect(res.headers.get("content-type"), rel).toBe(contentType);
			expect(await res.text()).toBe(body);
		}
	});

	test("emits the hardening headers on every response, including 404s, with tiered Cache-Control", async () => {
		const previewId = await servedSnapshot({
			"index.html": "<html></html>",
			"img/photo.png": "PNGDATA",
		});

		const cases: Array<[string, number, string]> = [
			[`${previewId}/index.html`, 200, "no-store"],
			[`${previewId}/img/photo.png`, 200, "no-cache"],
			[`${previewId}/missing.css`, 404, "no-store"],
			[`${UNKNOWN_ID}/index.html`, 404, "no-store"],
		];
		for (const [suffix, status, cacheControl] of cases) {
			const res = await anonApp.request(`/api/v1/preview/${suffix}`);
			expect(res.status, suffix).toBe(status);
			expect(res.headers.get("x-content-type-options"), suffix).toBe("nosniff");
			expect(res.headers.get("referrer-policy"), suffix).toBe("no-referrer");
			expect(res.headers.get("permissions-policy"), suffix).toBe(
				"camera=(), microphone=(), geolocation=(), payment=()",
			);
			expect(res.headers.get("access-control-allow-origin"), suffix).toBe("*");
			expect(res.headers.get("cache-control"), suffix).toBe(cacheControl);
		}
	});

	test("adds the byte-identical sandbox CSP to every scriptable type and to none of the passive ones", async () => {
		const previewId = await servedSnapshot({
			"index.html": "<html></html>",
			"page.xhtml": "<html/>",
			"data.xml": "<root/>",
			"img/inline.svg": "<svg></svg>",
			"style/main.css": "body{}",
			"img/photo.png": "PNGDATA",
		});

		for (const rel of [
			"index.html",
			"page.xhtml",
			"data.xml",
			"img/inline.svg",
		]) {
			const res = await anonApp.request(`/api/v1/preview/${previewId}/${rel}`);
			expect(res.headers.get("content-security-policy"), rel).toBe(
				EXPECTED_PREVIEW_CSP,
			);
		}
		for (const rel of ["style/main.css", "img/photo.png"]) {
			const res = await anonApp.request(`/api/v1/preview/${previewId}/${rel}`);
			expect(res.headers.get("content-security-policy"), rel).toBeNull();
		}
	});

	test("redirects the bare capability URL (and trailing slash) to index.html (302)", async () => {
		const previewId = await servedSnapshot({
			"index.html": "<html>root</html>",
		});
		// The Location is RELATIVE (BASE_PATH / app:// safe), byte-identical to
		// core: no trailing slash → {id}/index.html (resolves against …/{id});
		// trailing slash → index.html (resolves against …/{id}/). Both land on
		// …/{id}/index.html without doubling or dropping the id.
		const cases: Array<[string, string]> = [
			["", `${previewId}/index.html`],
			["/", "index.html"],
		];
		for (const [suffix, expectedLocation] of cases) {
			const res = await ownerApp.request(
				`/api/v1/preview/${previewId}${suffix}`,
				{ redirect: "manual" },
			);
			expect(res.status, `suffix "${suffix}"`).toBe(302);
			expect(res.headers.get("location"), `suffix "${suffix}"`).toBe(
				expectedLocation,
			);
			// Hardening headers ride even the redirect; the redirect is never cached.
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
			expect(res.headers.get("cache-control")).toBe("no-store");
			// The bare URL must not leak the document bytes.
			expect(await res.text()).toBe("");
		}
	});

	test("rejects traversal attempts and malformed ids with 404", async () => {
		const previewId = await servedSnapshot({ "index.html": "<html></html>" });
		const paths = [
			`/api/v1/preview/${previewId}/%2e%2e/secret`,
			`/api/v1/preview/${previewId}/%2e%2e%2fsecret`,
			`/api/v1/preview/${previewId}/a%2f..%2f..%2fsecret`,
			`/api/v1/preview/${previewId}/%00`,
			`/api/v1/preview/not-a-uuid/index.html`,
		];
		for (const p of paths) {
			expect((await ownerApp.request(p)).status, p).toBe(404);
		}
	});

	test("resolves the relative path even when a hex char of the id segment is percent-encoded", async () => {
		const previewId = await servedSnapshot({
			"index.html": "<html>root</html>",
			"html/page.html": "<html>deep</html>",
		});
		// Percent-encode the first hex char of the (valid, existing) id so the raw
		// id segment differs from the server-decoded id. The relPath derivation must
		// not desync: the request has to serve the SAME file as the un-encoded id.
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

	test("returns 404 after the snapshot is deleted", async () => {
		const previewId = await servedSnapshot({ "index.html": "<html></html>" });
		await ownerApp.request(`/api/v1/preview-session/${previewId}`, {
			method: "DELETE",
		});

		const res = await anonApp.request(
			`/api/v1/preview/${previewId}/index.html`,
		);
		expect(res.status).toBe(404);
	});

	test("serves updated bytes after a refresh and drops paths the new archive omits", async () => {
		const previewId = await servedSnapshot({
			"index.html": "<html>v1</html>",
			"keep.css": "keep{}",
			"gone.css": "gone{}",
		});

		await postSnapshot(
			{ "index.html": "<html>v2</html>", "keep.css": "keep{}" },
			{ previewId },
		);

		const updated = await anonApp.request(
			`/api/v1/preview/${previewId}/index.html`,
		);
		expect(await updated.text()).toBe("<html>v2</html>");
		const kept = await anonApp.request(`/api/v1/preview/${previewId}/keep.css`);
		expect(kept.status).toBe(200);
		const dropped = await anonApp.request(
			`/api/v1/preview/${previewId}/gone.css`,
		);
		expect(dropped.status).toBe(404);
	});
});

describe("GET /api/v1/preview asset tier (ETag / Range)", () => {
	const CLIP = "0123456789";

	async function clipSnapshot(): Promise<string> {
		return servedSnapshot({
			"index.html": "<html></html>",
			"media/clip.mp4": CLIP,
		});
	}

	test("serves assets with the revalidating tier: no-cache, ETag, Accept-Ranges", async () => {
		const previewId = await clipSnapshot();

		const res = await anonApp.request(
			`/api/v1/preview/${previewId}/media/clip.mp4`,
		);

		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-cache");
		expect(res.headers.get("accept-ranges")).toBe("bytes");
		expect(res.headers.get("etag")).toBeTruthy();
		expect(res.headers.get("content-security-policy")).toBeNull();
	});

	test("answers If-None-Match with 304 when the ETag matches", async () => {
		const previewId = await clipSnapshot();
		const first = await anonApp.request(
			`/api/v1/preview/${previewId}/media/clip.mp4`,
		);
		const etag = first.headers.get("etag") as string;

		const res = await anonApp.request(
			`/api/v1/preview/${previewId}/media/clip.mp4`,
			{ headers: { "If-None-Match": etag } },
		);

		expect(res.status).toBe(304);
		expect(await res.text()).toBe("");
	});

	/**
	 * A refresh mints new bytes under the same capability, so the previous ETag
	 * must stop matching — otherwise the browser keeps the stale asset forever.
	 */
	test("a refreshed asset no longer matches the previous ETag", async () => {
		const previewId = await servedSnapshot({
			"index.html": "<html></html>",
			"img/logo.png": "v1",
		});
		const stale = (
			await anonApp.request(`/api/v1/preview/${previewId}/img/logo.png`)
		).headers.get("etag") as string;

		await postSnapshot(
			{ "index.html": "<html></html>", "img/logo.png": "v2" },
			{ previewId },
		);

		const res = await anonApp.request(
			`/api/v1/preview/${previewId}/img/logo.png`,
			{ headers: { "If-None-Match": stale } },
		);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("v2");
	});

	test("serves a satisfiable single range as 206 with Content-Range", async () => {
		const previewId = await clipSnapshot();

		const res = await anonApp.request(
			`/api/v1/preview/${previewId}/media/clip.mp4`,
			{ headers: { Range: "bytes=2-4" } },
		);

		expect(res.status).toBe(206);
		expect(res.headers.get("content-range")).toBe("bytes 2-4/10");
		expect(res.headers.get("content-length")).toBe("3");
		expect(await res.text()).toBe("234");
	});

	test("serves a suffix range (last N bytes) as 206", async () => {
		const previewId = await clipSnapshot();

		const res = await anonApp.request(
			`/api/v1/preview/${previewId}/media/clip.mp4`,
			{ headers: { Range: "bytes=-3" } },
		);

		expect(res.status).toBe(206);
		expect(res.headers.get("content-range")).toBe("bytes 7-9/10");
		expect(await res.text()).toBe("789");
	});

	test.each([
		["bytes=99-"],
		["bytes=-0"],
	])("answers the valid unsatisfiable range %s with 416", async (range) => {
		const previewId = await clipSnapshot();

		const res = await anonApp.request(
			`/api/v1/preview/${previewId}/media/clip.mp4`,
			{ headers: { Range: range } },
		);

		expect(res.status).toBe(416);
		expect(res.headers.get("content-range")).toBe("bytes */10");
	});

	test.each([
		["bytes=abc"],
		["bytes=0-1,2-3"],
		["items=0-1"],
		["bytes=-"],
		["not-a-range"],
		["bytes=5-2"],
	])("ignores the unhonored Range header %s and serves the full 200", async (range) => {
		const previewId = await clipSnapshot();

		const res = await anonApp.request(
			`/api/v1/preview/${previewId}/media/clip.mp4`,
			{ headers: { Range: range } },
		);

		expect(res.status).toBe(200);
		expect(await res.text()).toBe(CLIP);
		expect(res.headers.get("content-range")).toBeNull();
	});
});
