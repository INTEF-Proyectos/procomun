import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	ASSET_KEY_RE,
	applyRevision,
	configure,
	contentTypeFor,
	createSession,
	DEFAULT_PREVIEW_SESSION_LIMITS,
	deleteSession,
	evaluatePreviewReplicaConfig,
	type FixedResourceResolver,
	getFile,
	getLimitsFromEnv,
	getOwnedSession,
	getSessionForServing,
	getStats,
	isScriptableDocumentType,
	normalizeContentPath,
	type PreviewSession,
	resetDependencies,
	sessionBytes,
	startPreviewSessionSweeper,
	stopPreviewSessionSweeper,
	storeAssets,
	sweepExpired,
} from "./preview-session-store.ts";

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeffff0000@9c41d2e8a1b03f57";
const KEY_B = "12345678-90ab-4cde-8f01-234567890abc@00112233";

function bytesOf(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

function textOf(bytes: Uint8Array | undefined): string {
	return bytes ? new TextDecoder().decode(bytes) : "";
}

/** An in-memory fixed-resource resolver for the fixed layer (layer 1). */
function fakeFixed(
	resources: Record<string, string> = {},
): FixedResourceResolver {
	const map = new Map(
		Object.entries(resources).map(([id, content]) => [id, bytesOf(content)]),
	);
	return {
		hasResource: (id) => map.has(id),
		getResource: (id) => {
			const bytes = map.get(id);
			return bytes ? { bytes, size: bytes.length } : null;
		},
	};
}

function ownedSession(previewId: string, ownerUserId: string): PreviewSession {
	const result = getOwnedSession(previewId, ownerUserId);
	if ("status" in result)
		throw new Error(`expected owned session, got ${result.status}`);
	return result.session;
}

/** Store the given assets, asserting they were all accepted. */
function putAssets(
	session: PreviewSession,
	assets: Record<string, string>,
): void {
	const result = storeAssets(
		session,
		Object.entries(assets).map(([key, content]) => {
			const bytes = bytesOf(content);
			return { key, declaredSize: bytes.length, bytes };
		}),
	);
	if (result.rejected.length > 0)
		throw new Error(
			`unexpected rejections: ${JSON.stringify(result.rejected)}`,
		);
}

beforeEach(() => {
	resetDependencies();
});

afterEach(() => {
	resetDependencies();
});

describe("getLimitsFromEnv", () => {
	it("falls back to the documented defaults", () => {
		const limits = getLimitsFromEnv({} as NodeJS.ProcessEnv);
		expect(limits).toEqual(DEFAULT_PREVIEW_SESSION_LIMITS);
		expect(limits.ttlMs).toBe(30 * 60 * 1000);
		expect(limits.maxSessionsPerUser).toBe(4);
		expect(limits.maxFilesPerSession).toBe(5000);
		expect(limits.maxBytesPerSession).toBe(200 * 1024 * 1024);
		expect(limits.maxAssetBytes).toBe(128 * 1024 * 1024);
		expect(limits.globalMaxBytes).toBe(2048 * 1024 * 1024);
	});

	it("parses the documented env knobs", () => {
		const limits = getLimitsFromEnv({
			PREVIEW_SESSION_TTL_MINUTES: "5",
			PREVIEW_MAX_SESSIONS_PER_USER: "2",
			PREVIEW_MAX_FILES_PER_SESSION: "10",
			PREVIEW_MAX_BYTES_PER_SESSION_MB: "1",
			PREVIEW_MAX_ASSET_BYTES_MB: "7",
			PREVIEW_GLOBAL_MAX_BYTES_MB: "3",
		} as unknown as NodeJS.ProcessEnv);
		expect(limits.ttlMs).toBe(5 * 60 * 1000);
		expect(limits.maxSessionsPerUser).toBe(2);
		expect(limits.maxFilesPerSession).toBe(10);
		expect(limits.maxBytesPerSession).toBe(1024 * 1024);
		expect(limits.maxAssetBytes).toBe(7 * 1024 * 1024);
		expect(limits.globalMaxBytes).toBe(3 * 1024 * 1024);
	});

	it("ignores non-numeric or non-positive values", () => {
		const limits = getLimitsFromEnv({
			PREVIEW_SESSION_TTL_MINUTES: "soon",
			PREVIEW_MAX_SESSIONS_PER_USER: "0",
			PREVIEW_MAX_BYTES_PER_SESSION_MB: "-5",
		} as unknown as NodeJS.ProcessEnv);
		expect(limits).toEqual(DEFAULT_PREVIEW_SESSION_LIMITS);
	});
});

describe("normalizeContentPath", () => {
	it("maps the empty path and bare slashes to index.html", () => {
		expect(normalizeContentPath("")).toBe("index.html");
		expect(normalizeContentPath("/")).toBe("index.html");
		expect(normalizeContentPath("///")).toBe("index.html");
	});

	it("strips query strings and fragments before resolving", () => {
		expect(normalizeContentPath("index.html?exe-teacher=1")).toBe("index.html");
		expect(normalizeContentPath("html/page.html#section")).toBe(
			"html/page.html",
		);
	});

	it("strips leading slashes and normalizes interior dot segments", () => {
		expect(normalizeContentPath("/theme/style.css")).toBe("theme/style.css");
		expect(normalizeContentPath("a/b/../c.html")).toBe("a/c.html");
		expect(normalizeContentPath("./index.html")).toBe("index.html");
	});

	it("rejects dot-dot traversal that escapes the root", () => {
		expect(normalizeContentPath("..")).toBeNull();
		expect(normalizeContentPath("../secret")).toBeNull();
		expect(normalizeContentPath("a/../../secret")).toBeNull();
		expect(normalizeContentPath("a/b/../../../etc/passwd")).toBeNull();
	});

	it("rejects encoded traversal and malformed encodings", () => {
		expect(normalizeContentPath("%2e%2e%2fsecret")).toBeNull();
		expect(normalizeContentPath("a%2f..%2f..%2fsecret")).toBeNull();
		expect(normalizeContentPath("%ZZ")).toBeNull();
	});

	it("rejects NUL bytes (literal and encoded)", () => {
		expect(normalizeContentPath("a\0b")).toBeNull();
		expect(normalizeContentPath("%00")).toBeNull();
	});

	it("treats backslashes as literal characters, not separators", () => {
		expect(normalizeContentPath("a\\..\\secret")).toBe("a\\..\\secret");
	});

	it("decodes percent-encoded segments that stay inside the root", () => {
		expect(normalizeContentPath("content/resources/my%20file.png")).toBe(
			"content/resources/my file.png",
		);
	});
});

describe("contentTypeFor", () => {
	it("returns charset-tagged types for textual content", () => {
		expect(contentTypeFor("index.html")).toBe("text/html; charset=utf-8");
		expect(contentTypeFor("theme/style.css")).toBe("text/css; charset=utf-8");
		expect(contentTypeFor("libs/app.js")).toBe(
			"application/javascript; charset=utf-8",
		);
		expect(contentTypeFor("img/logo.svg")).toBe("image/svg+xml; charset=utf-8");
		expect(contentTypeFor("content/content.xml")).toBe(
			"application/xml; charset=utf-8",
		);
		expect(contentTypeFor("page.xhtml")).toBe(
			"application/xhtml+xml; charset=utf-8",
		);
	});

	it("returns bare types for binary content and defaults to octet-stream", () => {
		expect(contentTypeFor("img/logo.png")).toBe("image/png");
		expect(contentTypeFor("media/clip.mp4")).toBe("video/mp4");
		expect(contentTypeFor("fonts/font.woff2")).toBe("font/woff2");
		expect(contentTypeFor("IMG/LOGO.PNG")).toBe("image/png");
		expect(contentTypeFor("file.unknownext")).toBe("application/octet-stream");
	});
});

describe("isScriptableDocumentType", () => {
	it("flags every scriptable document type, charset and all", () => {
		for (const type of [
			"text/html",
			"text/html; charset=utf-8",
			"image/svg+xml",
			"image/svg+xml; charset=utf-8",
			"application/xml",
			"text/xml",
			"application/xhtml+xml",
		]) {
			expect(isScriptableDocumentType(type)).toBe(true);
		}
	});

	it("does not flag passive types", () => {
		for (const type of [
			"text/css",
			"application/javascript",
			"image/png",
			"font/woff2",
		]) {
			expect(isScriptableDocumentType(type)).toBe(false);
		}
	});
});

describe("session lifecycle and ownership", () => {
	it("creates sessions with unguessable UUID ids at revision 0", () => {
		const { previewId } = createSession("u1");
		expect(previewId).toMatch(UUID_RE);
		expect(ownedSession(previewId, "u1").revision).toBe(0);
		expect(createSession("u1").previewId).not.toBe(previewId);
	});

	it("rejects access by non-owners with 403 and unknown ids with 404", () => {
		const { previewId } = createSession("u1");
		expect(getOwnedSession(previewId, "u2")).toEqual({ status: 403 });
		expect(
			getOwnedSession("11111111-2222-4333-8444-555555555555", "u1"),
		).toEqual({ status: 404 });
		expect("session" in getOwnedSession(previewId, "u1")).toBe(true);
	});

	it("evicts the owner least-recently-used session over the per-user cap", () => {
		let clock = 1000;
		configure({
			now: () => clock,
			limits: { ...DEFAULT_PREVIEW_SESSION_LIMITS, maxSessionsPerUser: 2 },
		});
		const first = createSession("u1").previewId;
		clock += 10;
		const second = createSession("u1").previewId;
		clock += 10;
		expect(getSessionForServing(first)).not.toBeNull();
		clock += 10;
		const third = createSession("u1").previewId;
		expect(getOwnedSession(second, "u1")).toEqual({ status: 404 });
		expect("session" in getOwnedSession(first, "u1")).toBe(true);
		expect("session" in getOwnedSession(third, "u1")).toBe(true);
	});

	it("keeps a different owner's sessions when one owner is over the cap", () => {
		configure({
			limits: { ...DEFAULT_PREVIEW_SESSION_LIMITS, maxSessionsPerUser: 1 },
		});
		const owned = createSession("u1").previewId;
		const foreign = createSession("u2").previewId;
		createSession("u1");
		expect(getOwnedSession(owned, "u1")).toEqual({ status: 404 });
		expect("session" in getOwnedSession(foreign, "u2")).toBe(true);
	});

	it("expires idle sessions after the TTL but keeps served ones alive", () => {
		let clock = 0;
		configure({
			now: () => clock,
			limits: { ...DEFAULT_PREVIEW_SESSION_LIMITS, ttlMs: 100 },
		});
		const active = createSession("u1").previewId;
		const idle = createSession("u2").previewId;
		clock = 90;
		expect(getSessionForServing(active)).not.toBeNull();
		clock = 150;
		expect(sweepExpired()).toBe(1);
		expect(getSessionForServing(idle)).toBeNull();
		expect(getSessionForServing(active)).not.toBeNull();
	});

	it("deletes sessions on demand", () => {
		const { previewId } = createSession("u1");
		expect(deleteSession(previewId)).toBe(true);
		expect(deleteSession(previewId)).toBe(false);
		expect(getSessionForServing(previewId)).toBeNull();
	});
});

describe("storeAssets (layer 2)", () => {
	const fixed = fakeFixed();

	it("validates the assetKey shape", () => {
		expect(ASSET_KEY_RE.test(KEY_A)).toBe(true);
		expect(ASSET_KEY_RE.test("not-a-key")).toBe(false);
	});

	it("stores well-formed assets and tracks byte accounting", () => {
		const session = ownedSession(createSession("u1").previewId, "u1");
		const photo = bytesOf("PHOTO-BYTES");
		const result = storeAssets(session, [
			{ key: KEY_A, declaredSize: photo.length, bytes: photo },
		]);
		expect(result.stored).toEqual([KEY_A]);
		expect(result.alreadyStored).toEqual([]);
		expect(result.rejected).toEqual([]);
		expect(session.assetBytes).toBe(photo.length);
		expect(sessionBytes(session)).toBe(photo.length);
		expect(getStats().globalBytes).toBe(photo.length);
	});

	it("treats keys as immutable: a re-upload is alreadyStored and never replaces bytes", () => {
		const session = ownedSession(createSession("u1").previewId, "u1");
		const v1 = bytesOf("PHOTO-v1");
		storeAssets(session, [{ key: KEY_A, declaredSize: v1.length, bytes: v1 }]);
		const v2 = bytesOf("PHOTO-v2-DIFFERENT");
		const result = storeAssets(session, [
			{ key: KEY_A, declaredSize: v2.length, bytes: v2 },
		]);
		expect(result.stored).toEqual([]);
		expect(result.alreadyStored).toEqual([KEY_A]);
		expect(textOf(session.assets.get(KEY_A))).toBe("PHOTO-v1");
		// The immutable re-upload does not double-count bytes either.
		expect(session.assetBytes).toBe(v1.length);
	});

	it("rejects invalid keys, size mismatches, and oversized assets per entry", () => {
		configure({
			limits: { ...DEFAULT_PREVIEW_SESSION_LIMITS, maxAssetBytes: 4 },
		});
		const session = ownedSession(createSession("u1").previewId, "u1");
		const bytes = bytesOf("hello");
		const result = storeAssets(session, [
			{ key: "bad-key", declaredSize: bytes.length, bytes },
			{ key: KEY_A, declaredSize: 999, bytes: bytesOf("mismatch") },
			{ key: KEY_B, declaredSize: bytes.length, bytes },
		]);
		expect(result.stored).toEqual([]);
		expect(result.rejected).toEqual([
			{ key: "bad-key", reason: "invalid-key" },
			{ key: KEY_A, reason: "size-mismatch" },
			{ key: KEY_B, reason: "asset-too-large" },
		]);
	});

	it("rejects an asset that would exceed the per-session byte budget", () => {
		configure({
			limits: { ...DEFAULT_PREVIEW_SESSION_LIMITS, maxBytesPerSession: 4 },
		});
		const session = ownedSession(createSession("u1").previewId, "u1");
		const bytes = bytesOf("12345");
		const result = storeAssets(session, [
			{ key: KEY_A, declaredSize: bytes.length, bytes },
		]);
		expect(result.rejected).toEqual([
			{ key: KEY_A, reason: "session-budget-exceeded" },
		]);
		expect(getStats().globalBytes).toBe(0);
	});

	it("evicts other LRU sessions to fit an asset in the global budget, never the current one", () => {
		let clock = 0;
		configure({
			now: () => clock,
			limits: { ...DEFAULT_PREVIEW_SESSION_LIMITS, globalMaxBytes: 10 },
		});
		const victimId = createSession("u1").previewId;
		putAssets(ownedSession(victimId, "u1"), { [KEY_A]: "123456" });
		clock += 10;
		const currentId = createSession("u2").previewId;
		putAssets(ownedSession(currentId, "u2"), { [KEY_B]: "12345678" });
		expect(getSessionForServing(victimId)).toBeNull();
		expect(getSessionForServing(currentId)).not.toBeNull();
	});

	it("rejects an asset that cannot fit the global budget even after evicting others", () => {
		configure({
			limits: { ...DEFAULT_PREVIEW_SESSION_LIMITS, globalMaxBytes: 4 },
		});
		const session = ownedSession(createSession("u1").previewId, "u1");
		const bytes = bytesOf("123456");
		const result = storeAssets(session, [
			{ key: KEY_A, declaredSize: bytes.length, bytes },
		]);
		expect(result.rejected).toEqual([
			{ key: KEY_A, reason: "global-budget-exceeded" },
		]);
	});

	it("keeps the fixed resolver out of the asset path (assets never touch it)", () => {
		const session = ownedSession(createSession("u1").previewId, "u1");
		putAssets(session, { [KEY_A]: "x" });
		expect(fixed.hasResource(KEY_A)).toBe(false);
	});
});

describe("applyRevision (layer 3)", () => {
	const fixed = fakeFixed({
		"libs/jquery": "jq",
		"theme:zen/content.css": "css",
	});

	function newSession(): PreviewSession {
		return ownedSession(createSession("u1").previewId, "u1");
	}

	function rev(
		session: PreviewSession,
		meta: {
			baseRevision: number;
			nextRevision: number;
			writes?: Record<string, string>;
			deletes?: string[];
			assetRefs?: Record<string, string>;
			fixedRefs?: Record<string, string>;
		},
	) {
		return applyRevision(
			session,
			{
				baseRevision: meta.baseRevision,
				nextRevision: meta.nextRevision,
				writes: Object.entries(meta.writes ?? {}).map(([path, content]) => ({
					path,
					bytes: bytesOf(content),
				})),
				deletes: meta.deletes ?? [],
				assetRefs: meta.assetRefs ?? {},
				fixedRefs: meta.fixedRefs ?? {},
			},
			fixed,
		);
	}

	it("publishes the first revision and bumps the active revision number", () => {
		const session = newSession();
		const result = rev(session, {
			baseRevision: 0,
			nextRevision: 1,
			writes: { "index.html": "hello" },
		});
		expect(result).toEqual({ revision: 1, active: true });
		expect(session.revision).toBe(1);
		expect(textOf(getFile(session, "index.html", fixed)?.bytes)).toBe("hello");
	});

	it("rejects a stale baseRevision or non-consecutive nextRevision with 409", () => {
		const session = newSession();
		rev(session, {
			baseRevision: 0,
			nextRevision: 1,
			writes: { "index.html": "v1" },
		});
		expect(
			rev(session, {
				baseRevision: 0,
				nextRevision: 1,
				writes: { "index.html": "stale" },
			}),
		).toEqual({
			status: 409,
			currentRevision: 1,
		});
		expect(
			rev(session, {
				baseRevision: 1,
				nextRevision: 3,
				writes: { "index.html": "skip" },
			}),
		).toEqual({
			status: 409,
			currentRevision: 1,
		});
		// A failed apply leaves the previous revision fully intact.
		expect(textOf(getFile(session, "index.html", fixed)?.bytes)).toBe("v1");
	});

	it("rejects unsafe paths in writes, deletes, assetRefs and fixedRefs with 400", () => {
		expect(
			rev(newSession(), {
				baseRevision: 0,
				nextRevision: 1,
				writes: { "../escape.html": "x" },
			}),
		).toMatchObject({
			status: 400,
		});
		expect(
			rev(newSession(), {
				baseRevision: 0,
				nextRevision: 1,
				deletes: ["../escape"],
			}),
		).toMatchObject({
			status: 400,
		});
		expect(
			rev(newSession(), {
				baseRevision: 0,
				nextRevision: 1,
				assetRefs: { "../a.png": KEY_A },
			}),
		).toMatchObject({ status: 400 });
		expect(
			rev(newSession(), {
				baseRevision: 0,
				nextRevision: 1,
				fixedRefs: { "../a.js": "libs/jquery" },
			}),
		).toMatchObject({ status: 400 });
	});

	it("rejects a revision that references an asset the session never stored with 422", () => {
		const session = newSession();
		const result = rev(session, {
			baseRevision: 0,
			nextRevision: 1,
			assetRefs: { "content/ghost.png": KEY_A },
		});
		expect(result).toEqual({
			status: 422,
			reason: "missing-assets",
			missing: [KEY_A],
		});
		expect(session.revision).toBe(0);
	});

	it("rejects a revision that references a fixed resource absent from the manifest with 422", () => {
		const session = newSession();
		const result = rev(session, {
			baseRevision: 0,
			nextRevision: 1,
			fixedRefs: { "libs/unknown.js": "libs/does-not-exist" },
		});
		expect(result).toEqual({
			status: 422,
			reason: "unknown-fixed-resources",
			resources: ["libs/does-not-exist"],
		});
	});

	it("resolves stored assets and manifest-listed fixed resources", () => {
		const session = newSession();
		putAssets(session, { [KEY_A]: "PHOTO" });
		const result = rev(session, {
			baseRevision: 0,
			nextRevision: 1,
			writes: { "index.html": "<html></html>" },
			assetRefs: { "content/photo.png": KEY_A },
			fixedRefs: { "libs/jquery.min.js": "libs/jquery" },
		});
		expect(result).toMatchObject({ active: true });
		expect(getFile(session, "content/photo.png", fixed)?.kind).toBe("asset");
		expect(getFile(session, "libs/jquery.min.js", fixed)?.kind).toBe("fixed");
	});

	it("applies deletes and overwrites across revisions with correct byte accounting", () => {
		const session = newSession();
		rev(session, {
			baseRevision: 0,
			nextRevision: 1,
			writes: { "a.html": "aaaa", "b.html": "bb" },
		});
		const bytesAfterFirst = session.documentBytes;
		expect(bytesAfterFirst).toBe(6);
		rev(session, {
			baseRevision: 1,
			nextRevision: 2,
			writes: { "a.html": "A" },
			deletes: ["b.html"],
		});
		expect(textOf(getFile(session, "a.html", fixed)?.bytes)).toBe("A");
		expect(getFile(session, "b.html", fixed)).toBeNull();
		expect(session.documentBytes).toBe(1);
	});

	it("rejects a revision over the file-count budget with 413", () => {
		configure({
			limits: { ...DEFAULT_PREVIEW_SESSION_LIMITS, maxFilesPerSession: 1 },
		});
		const session = newSession();
		const result = rev(session, {
			baseRevision: 0,
			nextRevision: 1,
			writes: { "a.html": "a", "b.html": "b" },
		});
		expect(result).toMatchObject({ status: 413 });
	});

	it("rejects a revision over the per-session byte budget with 413", () => {
		configure({
			limits: { ...DEFAULT_PREVIEW_SESSION_LIMITS, maxBytesPerSession: 3 },
		});
		const session = newSession();
		const result = rev(session, {
			baseRevision: 0,
			nextRevision: 1,
			writes: { "a.html": "1234" },
		});
		expect(result).toMatchObject({ status: 413 });
		expect(session.revision).toBe(0);
	});

	it("rejects a revision that cannot fit the global budget with 413", () => {
		configure({
			limits: { ...DEFAULT_PREVIEW_SESSION_LIMITS, globalMaxBytes: 3 },
		});
		const session = newSession();
		const result = rev(session, {
			baseRevision: 0,
			nextRevision: 1,
			writes: { "a.html": "1234" },
		});
		expect(result).toMatchObject({ status: 413 });
	});

	it("counts a deletes-only revision toward the revision sequence", () => {
		const session = newSession();
		rev(session, {
			baseRevision: 0,
			nextRevision: 1,
			writes: { "a.html": "a", "b.html": "b" },
		});
		const result = rev(session, {
			baseRevision: 1,
			nextRevision: 2,
			deletes: ["a.html"],
		});
		expect(result).toMatchObject({ active: true, revision: 2 });
		expect(getFile(session, "a.html", fixed)).toBeNull();
	});
});

describe("getFile (three-layer resolution)", () => {
	const fixed = fakeFixed({ "libs/jquery": "JQ-BYTES" });

	it("returns null before the first revision publishes (revision 0)", () => {
		const session = ownedSession(createSession("u1").previewId, "u1");
		expect(getFile(session, "index.html", fixed)).toBeNull();
	});

	it("resolves documents ahead of assets ahead of fixed for the same served path", () => {
		const session = ownedSession(createSession("u1").previewId, "u1");
		putAssets(session, { [KEY_A]: "ASSET" });
		applyRevision(
			session,
			{
				baseRevision: 0,
				nextRevision: 1,
				writes: [{ path: "index.html", bytes: bytesOf("DOC") }],
				deletes: [],
				// index.html is also mapped as an asset AND a fixed ref; the document wins.
				assetRefs: { "index.html": KEY_A, "photo.png": KEY_A },
				fixedRefs: { "index.html": "libs/jquery", "app.js": "libs/jquery" },
			},
			fixed,
		);
		expect(getFile(session, "index.html", fixed)).toMatchObject({
			kind: "document",
		});
		expect(textOf(getFile(session, "index.html", fixed)?.bytes)).toBe("DOC");
		expect(getFile(session, "photo.png", fixed)).toMatchObject({
			kind: "asset",
			etag: KEY_A,
		});
		expect(getFile(session, "app.js", fixed)).toMatchObject({ kind: "fixed" });
	});

	it("flags scriptable document types and returns null for unknown/traversal paths", () => {
		const session = ownedSession(createSession("u1").previewId, "u1");
		applyRevision(
			session,
			{
				baseRevision: 0,
				nextRevision: 1,
				writes: [
					{ path: "index.html", bytes: bytesOf("<html></html>") },
					{ path: "img/logo.svg", bytes: bytesOf("<svg/>") },
					{ path: "theme/style.css", bytes: bytesOf("body{}") },
				],
				deletes: [],
				assetRefs: {},
				fixedRefs: {},
			},
			fixed,
		);
		expect(getFile(session, "index.html", fixed)?.isScriptable).toBe(true);
		expect(getFile(session, "img/logo.svg", fixed)?.isScriptable).toBe(true);
		expect(getFile(session, "theme/style.css", fixed)?.isScriptable).toBe(
			false,
		);
		expect(getFile(session, "missing.html", fixed)).toBeNull();
		expect(getFile(session, "../secret", fixed)).toBeNull();
		expect(getFile(session, "%2e%2e%2fsecret", fixed)).toBeNull();
	});

	it("returns null when an asset ref points at a key that is not stored", () => {
		const session = ownedSession(createSession("u1").previewId, "u1");
		// Force an assetRef without the backing asset by mutating after publish
		// (applyRevision would 422, so we exercise getFile's defensive miss).
		applyRevision(
			session,
			{
				baseRevision: 0,
				nextRevision: 1,
				writes: [{ path: "index.html", bytes: bytesOf("x") }],
				deletes: [],
				assetRefs: {},
				fixedRefs: {},
			},
			fixed,
		);
		(session.assetRefs as Map<string, string>).set("orphan.png", KEY_B);
		expect(getFile(session, "orphan.png", fixed)).toBeNull();
	});
});

describe("evaluatePreviewReplicaConfig", () => {
	it("is silent for a single-replica deployment (flag unset)", () => {
		expect(evaluatePreviewReplicaConfig({} as NodeJS.ProcessEnv)).toBeNull();
	});

	it("warns when multi-replica is declared without sticky-routing confirmation", () => {
		const warning = evaluatePreviewReplicaConfig({
			PREVIEW_MULTI_REPLICA: "1",
		} as NodeJS.ProcessEnv);
		expect(warning).toContain("sticky routing");
		expect(warning).toContain("PREVIEW_STICKY_ROUTING_CONFIRMED");
	});

	it("is silent once sticky routing is confirmed", () => {
		expect(
			evaluatePreviewReplicaConfig({
				PREVIEW_MULTI_REPLICA: "true",
				PREVIEW_STICKY_ROUTING_CONFIRMED: "yes",
			} as NodeJS.ProcessEnv),
		).toBeNull();
	});

	it("treats non-truthy flag values as off", () => {
		expect(
			evaluatePreviewReplicaConfig({
				PREVIEW_MULTI_REPLICA: "0",
			} as NodeJS.ProcessEnv),
		).toBeNull();
		// A confirmation that is not truthy does not silence a genuine warning.
		expect(
			evaluatePreviewReplicaConfig({
				PREVIEW_MULTI_REPLICA: "on",
				PREVIEW_STICKY_ROUTING_CONFIRMED: "maybe",
			} as NodeJS.ProcessEnv),
		).toContain("sticky routing");
	});
});

describe("sweeper", () => {
	it("start is idempotent and stop clears the timer", () => {
		startPreviewSessionSweeper(60_000);
		startPreviewSessionSweeper(60_000);
		stopPreviewSessionSweeper();
		stopPreviewSessionSweeper();
	});

	it("resetDependencies clears the store and stops the sweeper", () => {
		const { previewId } = createSession("u1");
		startPreviewSessionSweeper(60_000);
		resetDependencies();
		expect(getSessionForServing(previewId)).toBeNull();
		expect(getStats()).toEqual({ sessions: 0, globalBytes: 0 });
	});
});
