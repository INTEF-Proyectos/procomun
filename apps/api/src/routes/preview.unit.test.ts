import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { AuthEnv } from "../auth/middleware.ts";
import { configure, resetDependencies } from "../services/preview-session-store.ts";
import { previewRoutes, previewSessionRoutes, RECOMMENDED_BATCH_BYTES } from "./preview.ts";

const OWNER = { id: "owner-1", role: "author", email: "owner@test.local", name: "Owner" };
const OTHER = { id: "other-2", role: "author", email: "other@test.local", name: "Other" };
const UNKNOWN_ID = "11111111-2222-4333-8444-555555555555";

function sha256Hex(bytes: Uint8Array): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(bytes);
	return hasher.digest("hex");
}

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
		c.set("session", mockUser ? ({ id: "test-session" } as AuthEnv["Variables"]["session"]) : null);
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
	const json = (await res.json()) as { previewId: string };
	return json.previewId;
}

async function stageViaApi(
	previewId: string,
	files: Record<string, { sha256: string; size: number }>,
	app = ownerApp,
): Promise<{ manifestId: string; missing: string[]; active: boolean }> {
	const res = await app.request(`/api/v1/preview-session/${previewId}/manifest`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ files }),
	});
	expect(res.status).toBe(200);
	return (await res.json()) as { manifestId: string; missing: string[]; active: boolean };
}

/** Full manifest-diff sync (stage + upload) so the session serves the files. */
async function syncViaApi(previewId: string, files: Record<string, string>, app = ownerApp): Promise<void> {
	const manifest: Record<string, { sha256: string; size: number }> = {};
	for (const [p, text] of Object.entries(files)) {
		const bytes = bytesOf(text);
		manifest[p] = { sha256: sha256Hex(bytes), size: bytes.length };
	}
	const staged = await stageViaApi(previewId, manifest, app);
	if (staged.active) return;

	const form = new FormData();
	form.append("manifestId", staged.manifestId);
	const hashes: string[] = [];
	for (const text of Object.values(files)) {
		const bytes = bytesOf(text);
		if (staged.missing.includes(sha256Hex(bytes))) {
			hashes.push(sha256Hex(bytes));
			form.append("files", new Blob([bytes]));
		}
	}
	form.append("hashes", JSON.stringify(hashes));
	const res = await app.request(`/api/v1/preview-session/${previewId}/blobs`, { method: "POST", body: form });
	expect(res.status).toBe(200);
	const stored = (await res.json()) as { active: boolean };
	expect(stored.active).toBe(true);
}

beforeEach(() => {
	resetDependencies();
});

afterEach(() => {
	resetDependencies();
});

describe("POST /api/v1/preview-session", () => {
	test("requires authentication", async () => {
		const res = await anonApp.request("/api/v1/preview-session", { method: "POST" });
		expect(res.status).toBe(401);
	});

	test("creates a session and advertises the upload limits", async () => {
		const res = await ownerApp.request("/api/v1/preview-session", { method: "POST" });
		expect(res.status).toBe(201);
		const json = (await res.json()) as {
			previewId: string;
			limits: { maxFilesPerSession: number; maxBytesPerSession: number; recommendedBatchBytes: number };
		};
		expect(json.previewId).toMatch(/^[0-9a-f-]{36}$/);
		expect(json.limits.maxFilesPerSession).toBeGreaterThan(0);
		expect(json.limits.maxBytesPerSession).toBeGreaterThan(0);
		expect(json.limits.recommendedBatchBytes).toBe(RECOMMENDED_BATCH_BYTES);
	});
});

describe("POST /api/v1/preview-session/:previewId/manifest", () => {
	test("enforces auth, ownership and existence", async () => {
		const previewId = await createViaApi();
		const body = { files: { "index.html": { sha256: sha256Hex(bytesOf("x")), size: 1 } } };
		const req = (app: typeof ownerApp, id: string) =>
			app.request(`/api/v1/preview-session/${id}/manifest`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
		expect((await req(anonApp, previewId)).status).toBe(401);
		expect((await req(otherApp, previewId)).status).toBe(403);
		expect((await req(ownerApp, UNKNOWN_ID)).status).toBe(404);
	});

	test("rejects malformed bodies and unsafe paths with 400", async () => {
		const previewId = await createViaApi();
		const malformed = await ownerApp.request(`/api/v1/preview-session/${previewId}/manifest`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ nope: true }),
		});
		expect(malformed.status).toBe(400);

		const notJson = await ownerApp.request(`/api/v1/preview-session/${previewId}/manifest`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not json",
		});
		expect(notJson.status).toBe(400);

		const unsafe = await ownerApp.request(`/api/v1/preview-session/${previewId}/manifest`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ files: { "../escape": { sha256: sha256Hex(bytesOf("x")), size: 1 } } }),
		});
		expect(unsafe.status).toBe(400);
	});

	test("returns the missing hashes for a fresh manifest", async () => {
		const previewId = await createViaApi();
		const bytes = bytesOf("<html></html>");
		const staged = await stageViaApi(previewId, {
			"index.html": { sha256: sha256Hex(bytes), size: bytes.length },
		});
		expect(staged.active).toBe(false);
		expect(staged.missing).toEqual([sha256Hex(bytes)]);
	});
});

describe("POST /api/v1/preview-session/:previewId/blobs", () => {
	test("enforces auth and ownership", async () => {
		const previewId = await createViaApi();
		const form = () => {
			const f = new FormData();
			f.append("manifestId", "any");
			f.append("hashes", "[]");
			return f;
		};
		const unauth = await anonApp.request(`/api/v1/preview-session/${previewId}/blobs`, {
			method: "POST",
			body: form(),
		});
		expect(unauth.status).toBe(401);
		const forbidden = await otherApp.request(`/api/v1/preview-session/${previewId}/blobs`, {
			method: "POST",
			body: form(),
		});
		expect(forbidden.status).toBe(403);
	});

	test("rejects stale manifest ids with 409 and bad hashes JSON with 400", async () => {
		const previewId = await createViaApi();
		const staleForm = new FormData();
		staleForm.append("manifestId", UNKNOWN_ID);
		staleForm.append("hashes", "[]");
		const stale = await ownerApp.request(`/api/v1/preview-session/${previewId}/blobs`, {
			method: "POST",
			body: staleForm,
		});
		expect(stale.status).toBe(409);

		const badForm = new FormData();
		badForm.append("manifestId", "x");
		badForm.append("hashes", "not json");
		const bad = await ownerApp.request(`/api/v1/preview-session/${previewId}/blobs`, {
			method: "POST",
			body: badForm,
		});
		expect(bad.status).toBe(400);
	});

	test("rejects a blobs upload missing the manifestId field with 400", async () => {
		const previewId = await createViaApi();
		const form = new FormData();
		form.append("hashes", "[]");
		const res = await ownerApp.request(`/api/v1/preview-session/${previewId}/blobs`, {
			method: "POST",
			body: form,
		});
		expect(res.status).toBe(400);
	});

	test("rejects a blobs upload with no hashes field with 400", async () => {
		const previewId = await createViaApi();
		const form = new FormData();
		form.append("manifestId", "x");
		const res = await ownerApp.request(`/api/v1/preview-session/${previewId}/blobs`, {
			method: "POST",
			body: form,
		});
		expect(res.status).toBe(400);
	});

	test("rejects hashes that parse to a non-array (e.g. an object) with 400", async () => {
		const previewId = await createViaApi();
		const form = new FormData();
		form.append("manifestId", "x");
		form.append("hashes", JSON.stringify({ nope: true }));
		const res = await ownerApp.request(`/api/v1/preview-session/${previewId}/blobs`, {
			method: "POST",
			body: form,
		});
		expect(res.status).toBe(400);
	});

	test("rejects mismatched hashes/files counts with 400", async () => {
		const previewId = await createViaApi();
		const form = new FormData();
		form.append("manifestId", "x");
		form.append("hashes", JSON.stringify(["a".repeat(64)]));
		// No files appended -> count mismatch.
		const res = await ownerApp.request(`/api/v1/preview-session/${previewId}/blobs`, {
			method: "POST",
			body: form,
		});
		expect(res.status).toBe(400);
	});

	test("stores missing blobs, reports mismatches, and stays inactive when incomplete", async () => {
		const previewId = await createViaApi();
		const good = bytesOf("good body");
		const goodHash = sha256Hex(good);
		const forgedHash = sha256Hex(bytesOf("claimed"));
		const staged = await stageViaApi(previewId, {
			"good.html": { sha256: goodHash, size: good.length },
			"forged.html": { sha256: forgedHash, size: 7 },
		});

		const form = new FormData();
		form.append("manifestId", staged.manifestId);
		form.append("hashes", JSON.stringify([goodHash, forgedHash]));
		form.append("files", new Blob([good]));
		form.append("files", new Blob([bytesOf("not the claimed bytes")]));
		const res = await ownerApp.request(`/api/v1/preview-session/${previewId}/blobs`, {
			method: "POST",
			body: form,
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as { stored: string[]; mismatched: string[]; active: boolean };
		expect(json.stored).toEqual([goodHash]);
		expect(json.mismatched).toEqual([forgedHash]);
		expect(json.active).toBe(false);
	});

	test("rejects batches whose declared size exceeds the session byte budget with 413", async () => {
		configure({
			limits: {
				ttlMs: 30 * 60 * 1000,
				maxSessionsPerUser: 4,
				maxFilesPerSession: 5000,
				maxBytesPerSession: 8,
				globalMaxBytes: 2048 * 1024 * 1024,
				sweepIntervalMs: 60 * 1000,
			},
		});
		const previewId = await createViaApi();
		const bytes = bytesOf("123456789");
		const staged = await stageViaApi(previewId, { "a.bin": { sha256: sha256Hex(bytes), size: 4 } });
		const form = new FormData();
		form.append("manifestId", staged.manifestId);
		form.append("hashes", JSON.stringify([sha256Hex(bytes)]));
		form.append("files", new Blob([bytes]));
		const res = await ownerApp.request(`/api/v1/preview-session/${previewId}/blobs`, {
			method: "POST",
			body: form,
		});
		expect(res.status).toBe(413);
	});
});

describe("DELETE /api/v1/preview-session/:previewId", () => {
	test("enforces auth and ownership, then deletes", async () => {
		const previewId = await createViaApi();
		expect((await anonApp.request(`/api/v1/preview-session/${previewId}`, { method: "DELETE" })).status).toBe(401);
		expect((await otherApp.request(`/api/v1/preview-session/${previewId}`, { method: "DELETE" })).status).toBe(403);
		const ok = await ownerApp.request(`/api/v1/preview-session/${previewId}`, { method: "DELETE" });
		expect(ok.status).toBe(200);
		const gone = await ownerApp.request(`/api/v1/preview-session/${previewId}`, { method: "DELETE" });
		expect(gone.status).toBe(404);
	});
});

describe("GET /api/v1/preview/:previewId/* (authless serving)", () => {
	async function servedSession(files: Record<string, string>): Promise<string> {
		const previewId = await createViaApi();
		await syncViaApi(previewId, files);
		return previewId;
	}

	test("serves files with correct MIME types (no auth required)", async () => {
		const previewId = await servedSession({
			"index.html": "<html><body>hi</body></html>",
			"theme/style.css": "body { color: red; }",
			"libs/app.js": "console.log(1);",
			"fonts/f.woff2": "binaryfont",
			"img/i.png": "binarypng",
			"img/v.svg": "<svg/>",
		});
		const cases: Array<[string, string]> = [
			["index.html", "text/html; charset=utf-8"],
			["theme/style.css", "text/css; charset=utf-8"],
			["libs/app.js", "application/javascript; charset=utf-8"],
			["fonts/f.woff2", "font/woff2"],
			["img/i.png", "image/png"],
			["img/v.svg", "image/svg+xml; charset=utf-8"],
		];
		for (const [p, mime] of cases) {
			// Serving works on the anon app too: the capability URL is the credential.
			const res = await anonApp.request(`/api/v1/preview/${previewId}/${p}`);
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toBe(mime);
		}
	});

	test("sends the security headers on every response, including 404s", async () => {
		const previewId = await servedSession({ "index.html": "<html></html>" });
		const ok = await ownerApp.request(`/api/v1/preview/${previewId}/index.html`);
		const missing = await ownerApp.request(`/api/v1/preview/${previewId}/missing.css`);
		const unknownSession = await ownerApp.request(`/api/v1/preview/${UNKNOWN_ID}/index.html`);
		expect(missing.status).toBe(404);
		expect(unknownSession.status).toBe(404);
		for (const res of [ok, missing, unknownSession]) {
			expect(res.headers.get("x-content-type-options")).toBe("nosniff");
			expect(res.headers.get("referrer-policy")).toBe("no-referrer");
			expect(res.headers.get("cache-control")).toBe("no-store");
			expect(res.headers.get("permissions-policy")).toContain("camera=()");
			expect(res.headers.get("access-control-allow-origin")).toBe("*");
		}
	});

	test("adds the sandbox CSP to every scriptable document type (HTML, SVG, XML), not just HTML", async () => {
		const previewId = await servedSession({
			"index.html": "<html></html>",
			"html/page2.html": "<html>2</html>",
			// The SVG case is the security-critical one: opened top-level it would
			// run its inline <script> same-origin without the CSP.
			"img/logo.svg": '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>',
			"data/feed.xml": '<?xml version="1.0"?><root/>',
			"theme/style.css": "body{}",
			"libs/app.js": "console.log(1);",
			"img/i.png": "binarypng",
		});
		// Byte-identical to eXe core previewCspHeader() (cross-repo drift is guarded by
		// scripts/check-embed-sync.mjs 'serving-contract'). Assert the WHOLE string, not
		// just the prefix, so a mutated middle directive is caught here too.
		const EXPECTED_PREVIEW_CSP =
			"sandbox allow-scripts allow-popups allow-forms; default-src 'self'; " +
			"script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
			"img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; " +
			"font-src 'self' data:; connect-src 'self'; " +
			"frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com; " +
			"child-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com; " +
			"object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";
		for (const scriptable of ["index.html", "html/page2.html", "img/logo.svg", "data/feed.xml"]) {
			const res = await ownerApp.request(`/api/v1/preview/${previewId}/${scriptable}`);
			const csp = res.headers.get("content-security-policy") ?? "";
			expect(csp).toBe(EXPECTED_PREVIEW_CSP);
			expect(csp).not.toContain("allow-same-origin");
		}
		for (const passive of ["theme/style.css", "libs/app.js", "img/i.png"]) {
			const res = await ownerApp.request(`/api/v1/preview/${previewId}/${passive}`);
			expect(res.headers.get("content-security-policy")).toBeNull();
		}
	});

	test("serves index.html for the bare session URL without redirecting", async () => {
		const previewId = await servedSession({ "index.html": "<html>root</html>" });
		for (const suffix of ["", "/"]) {
			const res = await ownerApp.request(`/api/v1/preview/${previewId}${suffix}`);
			expect(res.status).toBe(200);
			expect([301, 302, 303, 307, 308]).not.toContain(res.status);
			expect(res.headers.get("location")).toBeNull();
			expect(await res.text()).toBe("<html>root</html>");
		}
	});

	test("rejects traversal attempts and malformed ids with 404", async () => {
		const previewId = await servedSession({ "index.html": "<html></html>" });
		const paths = [
			`/api/v1/preview/${previewId}/%2e%2e/secret`,
			`/api/v1/preview/${previewId}/%2e%2e%2fsecret`,
			`/api/v1/preview/${previewId}/a%2f..%2f..%2fsecret`,
			`/api/v1/preview/${previewId}/%00`,
			`/api/v1/preview/${previewId}/..%2f..%2fetc%2fpasswd`,
			`/api/v1/preview/not-a-uuid/index.html`,
		];
		for (const p of paths) {
			const res = await ownerApp.request(p);
			expect(res.status).toBe(404);
		}
	});

	test("returns 404 after the session is deleted", async () => {
		const previewId = await servedSession({ "index.html": "x" });
		const deleted = await ownerApp.request(`/api/v1/preview-session/${previewId}`, { method: "DELETE" });
		expect(deleted.status).toBe(200);
		const gone = await ownerApp.request(`/api/v1/preview/${previewId}/index.html`);
		expect(gone.status).toBe(404);
	});

	test("serves updated bytes after a manifest-diff refresh and keeps unchanged paths", async () => {
		const previewId = await servedSession({
			"index.html": "version one",
			"theme/style.css": "unchanged css",
		});
		await syncViaApi(previewId, {
			"index.html": "version two!",
			"theme/style.css": "unchanged css",
		});
		const index = await ownerApp.request(`/api/v1/preview/${previewId}/index.html`);
		expect(await index.text()).toBe("version two!");
		const css = await ownerApp.request(`/api/v1/preview/${previewId}/theme/style.css`);
		expect(await css.text()).toBe("unchanged css");
	});
});
