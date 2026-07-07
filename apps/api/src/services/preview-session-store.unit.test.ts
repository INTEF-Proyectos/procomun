import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	configure,
	contentTypeFor,
	createSession,
	DEFAULT_PREVIEW_SESSION_LIMITS,
	deleteSession,
	getFile,
	getLimitsFromEnv,
	getOwnedSession,
	getSessionForServing,
	getStats,
	normalizeContentPath,
	type PreviewSession,
	resetDependencies,
	stageManifest,
	startPreviewSessionSweeper,
	stopPreviewSessionSweeper,
	storeBlobs,
	sweepExpired,
} from "./preview-session-store.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function sha256Hex(bytes: Uint8Array): string {
	const hasher = new Bun.CryptoHasher("sha256");
	hasher.update(bytes);
	return hasher.digest("hex");
}

function bytesOf(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

/** Stage + upload a full manifest so the session serves the given files. */
async function syncFiles(session: PreviewSession, files: Record<string, string>): Promise<void> {
	const manifest: Record<string, { sha256: string; size: number }> = {};
	const blobs: Array<{ declaredSha256: string; bytes: Uint8Array }> = [];
	for (const [p, text] of Object.entries(files)) {
		const bytes = bytesOf(text);
		const hash = sha256Hex(bytes);
		manifest[p] = { sha256: hash, size: bytes.length };
		blobs.push({ declaredSha256: hash, bytes });
	}
	const staged = stageManifest(session, manifest);
	if ("status" in staged) throw new Error(`stageManifest failed: ${staged.message}`);
	if (staged.active) return;
	const stored = await storeBlobs(session, staged.manifestId, blobs);
	if ("status" in stored) throw new Error(`storeBlobs failed: ${stored.message}`);
	if (!stored.active) throw new Error("sync did not activate the manifest");
}

function ownedSession(previewId: string, ownerUserId: string): PreviewSession {
	const result = getOwnedSession(previewId, ownerUserId);
	if ("status" in result) throw new Error(`expected owned session, got ${result.status}`);
	return result.session;
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
		expect(limits.globalMaxBytes).toBe(2048 * 1024 * 1024);
	});

	it("parses the documented env knobs", () => {
		const limits = getLimitsFromEnv({
			PREVIEW_SESSION_TTL_MINUTES: "5",
			PREVIEW_MAX_SESSIONS_PER_USER: "2",
			PREVIEW_MAX_FILES_PER_SESSION: "10",
			PREVIEW_MAX_BYTES_PER_SESSION_MB: "1",
			PREVIEW_GLOBAL_MAX_BYTES_MB: "3",
		} as unknown as NodeJS.ProcessEnv);
		expect(limits.ttlMs).toBe(5 * 60 * 1000);
		expect(limits.maxSessionsPerUser).toBe(2);
		expect(limits.maxFilesPerSession).toBe(10);
		expect(limits.maxBytesPerSession).toBe(1024 * 1024);
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
		expect(normalizeContentPath("html/page.html#section")).toBe("html/page.html");
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
		// A literal backslash never becomes a path separator, so it cannot escape.
		expect(normalizeContentPath("a\\..\\secret")).toBe("a\\..\\secret");
	});

	it("decodes percent-encoded segments that stay inside the root", () => {
		expect(normalizeContentPath("content/resources/my%20file.png")).toBe("content/resources/my file.png");
	});
});

describe("contentTypeFor", () => {
	it("returns charset-tagged types for textual content", () => {
		expect(contentTypeFor("index.html")).toBe("text/html; charset=utf-8");
		expect(contentTypeFor("theme/style.css")).toBe("text/css; charset=utf-8");
		expect(contentTypeFor("libs/app.js")).toBe("application/javascript; charset=utf-8");
		expect(contentTypeFor("img/logo.svg")).toBe("image/svg+xml; charset=utf-8");
		expect(contentTypeFor("content/content.xml")).toBe("application/xml; charset=utf-8");
	});

	it("returns bare types for binary content and defaults to octet-stream", () => {
		expect(contentTypeFor("img/logo.png")).toBe("image/png");
		expect(contentTypeFor("fonts/font.woff2")).toBe("font/woff2");
		expect(contentTypeFor("IMG/LOGO.PNG")).toBe("image/png");
		expect(contentTypeFor("file.unknownext")).toBe("application/octet-stream");
	});
});

describe("session lifecycle and ownership", () => {
	it("creates sessions with unguessable UUID ids", () => {
		const { previewId } = createSession("u1");
		expect(previewId).toMatch(UUID_RE);
		const other = createSession("u1");
		expect(other.previewId).not.toBe(previewId);
	});

	it("rejects access by non-owners with 403 and unknown ids with 404", () => {
		const { previewId } = createSession("u1");
		expect(getOwnedSession(previewId, "u2")).toEqual({ status: 403 });
		expect(getOwnedSession("11111111-2222-4333-8444-555555555555", "u1")).toEqual({ status: 404 });
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
		// Touch the first session so the second becomes the LRU candidate.
		expect(getSessionForServing(first)).not.toBeNull();
		clock += 10;
		const third = createSession("u1").previewId;
		expect(getOwnedSession(second, "u1")).toEqual({ status: 404 });
		expect("session" in getOwnedSession(first, "u1")).toBe(true);
		expect("session" in getOwnedSession(third, "u1")).toBe(true);
	});

	it("keeps a different owner's sessions when one owner is over the cap", () => {
		configure({ limits: { ...DEFAULT_PREVIEW_SESSION_LIMITS, maxSessionsPerUser: 1 } });
		const owned = createSession("u1").previewId;
		const foreign = createSession("u2").previewId;
		createSession("u1"); // evicts u1's first session, not u2's
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
		// GET traffic touches lastAccessAt and must keep the session alive.
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

describe("stageManifest", () => {
	it("rejects an empty manifest with 400", () => {
		const session = ownedSession(createSession("u1").previewId, "u1");
		expect(stageManifest(session, {})).toMatchObject({ status: 400 });
	});

	it("reports every unknown hash as missing without activating", () => {
		const session = ownedSession(createSession("u1").previewId, "u1");
		const a = sha256Hex(bytesOf("a"));
		const b = sha256Hex(bytesOf("b"));
		const staged = stageManifest(session, {
			"index.html": { sha256: a, size: 1 },
			"theme/style.css": { sha256: b, size: 1 },
		});
		if ("status" in staged) throw new Error("unexpected error");
		expect(staged.active).toBe(false);
		expect(staged.missing.sort()).toEqual([a, b].sort());
		expect(getFile(session, "index.html")).toBeNull();
	});

	it("lists a hash shared by several paths once and one blob satisfies all of them", async () => {
		const session = ownedSession(createSession("u1").previewId, "u1");
		const shared = bytesOf("shared body");
		const hash = sha256Hex(shared);
		const staged = stageManifest(session, {
			"index.html": { sha256: hash, size: shared.length },
			"html/copy.html": { sha256: hash, size: shared.length },
		});
		if ("status" in staged) throw new Error("unexpected error");
		expect(staged.missing).toEqual([hash]);
		const stored = await storeBlobs(session, staged.manifestId, [{ declaredSha256: hash, bytes: shared }]);
		if ("status" in stored) throw new Error("unexpected error");
		expect(stored.active).toBe(true);
		expect(getFile(session, "index.html")?.bytes).toEqual(shared);
		expect(getFile(session, "html/copy.html")?.bytes).toEqual(shared);
	});

	it("promotes immediately when every hash is already stored", async () => {
		const session = ownedSession(createSession("u1").previewId, "u1");
		await syncFiles(session, { "index.html": "<html></html>" });
		const bytes = bytesOf("<html></html>");
		const staged = stageManifest(session, {
			"renamed.html": { sha256: sha256Hex(bytes), size: bytes.length },
		});
		if ("status" in staged) throw new Error("unexpected error");
		expect(staged.active).toBe(true);
		expect(staged.missing).toEqual([]);
		expect(getFile(session, "renamed.html")).not.toBeNull();
		expect(getFile(session, "index.html")).toBeNull();
	});

	it("rejects manifests with unsafe paths (400)", () => {
		const session = ownedSession(createSession("u1").previewId, "u1");
		const staged = stageManifest(session, {
			"../escape.html": { sha256: sha256Hex(bytesOf("x")), size: 1 },
		});
		expect(staged).toMatchObject({ status: 400 });
	});

	it("rejects manifests with an invalid sha256 or negative size (400)", () => {
		const session = ownedSession(createSession("u1").previewId, "u1");
		expect(stageManifest(session, { "a.html": { sha256: "nothex", size: 1 } })).toMatchObject({ status: 400 });
		expect(
			stageManifest(session, { "a.html": { sha256: sha256Hex(bytesOf("a")), size: -1 } }),
		).toMatchObject({ status: 400 });
	});

	it("rejects manifests over the file-count and byte caps with 413", () => {
		configure({
			limits: { ...DEFAULT_PREVIEW_SESSION_LIMITS, maxFilesPerSession: 1, maxBytesPerSession: 10 },
		});
		const session = ownedSession(createSession("u1").previewId, "u1");
		const tooMany = stageManifest(session, {
			"a.html": { sha256: sha256Hex(bytesOf("a")), size: 1 },
			"b.html": { sha256: sha256Hex(bytesOf("b")), size: 1 },
		});
		expect(tooMany).toMatchObject({ status: 413 });
		const tooBig = stageManifest(session, {
			"a.html": { sha256: sha256Hex(bytesOf("a")), size: 11 },
		});
		expect(tooBig).toMatchObject({ status: 413 });
	});
});

describe("storeBlobs", () => {
	it("quarantines blobs whose recomputed hash differs from the declared one", async () => {
		const session = ownedSession(createSession("u1").previewId, "u1");
		const good = bytesOf("good");
		const goodHash = sha256Hex(good);
		const forgedHash = sha256Hex(bytesOf("claimed"));
		const staged = stageManifest(session, {
			"good.html": { sha256: goodHash, size: good.length },
			"forged.html": { sha256: forgedHash, size: 7 },
		});
		if ("status" in staged) throw new Error("unexpected error");
		const stored = await storeBlobs(session, staged.manifestId, [
			{ declaredSha256: goodHash, bytes: good },
			{ declaredSha256: forgedHash, bytes: bytesOf("not the claimed bytes") },
		]);
		if ("status" in stored) throw new Error("unexpected error");
		expect(stored.stored).toEqual([goodHash]);
		expect(stored.mismatched).toEqual([forgedHash]);
		expect(stored.active).toBe(false);
		// The mismatched blob is never stored, so its path can never be served.
		expect(getFile(session, "good.html")).toBeNull();
	});

	it("ignores blobs not declared missing by the pending manifest", async () => {
		const session = ownedSession(createSession("u1").previewId, "u1");
		const wanted = bytesOf("wanted");
		const wantedHash = sha256Hex(wanted);
		const staged = stageManifest(session, { "wanted.html": { sha256: wantedHash, size: wanted.length } });
		if ("status" in staged) throw new Error("unexpected error");
		const stray = bytesOf("stray blob nobody asked for");
		const stored = await storeBlobs(session, staged.manifestId, [
			{ declaredSha256: wantedHash, bytes: wanted },
			{ declaredSha256: sha256Hex(stray), bytes: stray },
		]);
		if ("status" in stored) throw new Error("unexpected error");
		expect(stored.active).toBe(true);
		// Only the declared blob is retained; the stray one is dropped.
		expect(session.blobs.size).toBe(1);
		expect(session.blobs.has(wantedHash)).toBe(true);
	});

	it("rejects uploads for a superseded manifest with 409", async () => {
		const session = ownedSession(createSession("u1").previewId, "u1");
		const a = bytesOf("a");
		const stagedOld = stageManifest(session, { "a.html": { sha256: sha256Hex(a), size: 1 } });
		if ("status" in stagedOld) throw new Error("unexpected error");
		const b = bytesOf("b");
		const stagedNew = stageManifest(session, { "b.html": { sha256: sha256Hex(b), size: 1 } });
		if ("status" in stagedNew) throw new Error("unexpected error");
		const stored = await storeBlobs(session, stagedOld.manifestId, [{ declaredSha256: sha256Hex(a), bytes: a }]);
		expect(stored).toMatchObject({ status: 409 });
	});

	it("detects a manifest superseded DURING the async re-hash and returns 409", async () => {
		const session = ownedSession(createSession("u1").previewId, "u1");
		const a = bytesOf("a");
		const staged = stageManifest(session, { "a.html": { sha256: sha256Hex(a), size: 1 } });
		if ("status" in staged) throw new Error("unexpected error");

		// Supersede the pending manifest the moment hashing begins (the client's
		// debounced refresh racing the in-flight upload round).
		configure({
			sha256: async (bytes: Uint8Array) => {
				const b = bytesOf("b");
				stageManifest(session, { "b.html": { sha256: sha256Hex(b), size: 1 } });
				return sha256Hex(bytes);
			},
		});
		const stored = await storeBlobs(session, staged.manifestId, [{ declaredSha256: sha256Hex(a), bytes: a }]);
		expect(stored).toMatchObject({ status: 409 });
	});

	it("rejects blob uploads that would exceed the session byte budget, leaving the store unchanged", async () => {
		configure({ limits: { ...DEFAULT_PREVIEW_SESSION_LIMITS, maxBytesPerSession: 8 } });
		const session = ownedSession(createSession("u1").previewId, "u1");
		const big = bytesOf("123456789");
		const staged = stageManifest(session, { "big.bin": { sha256: sha256Hex(big), size: 4 } });
		if ("status" in staged) throw new Error("unexpected error");
		const stored = await storeBlobs(session, staged.manifestId, [{ declaredSha256: sha256Hex(big), bytes: big }]);
		expect(stored).toMatchObject({ status: 413 });
		expect(getStats().globalBytes).toBe(0);
	});

	it("evicts other least-recently-used sessions to fit the global budget but never the current one", async () => {
		let clock = 0;
		configure({
			now: () => clock,
			limits: { ...DEFAULT_PREVIEW_SESSION_LIMITS, globalMaxBytes: 10 },
		});
		const victimId = createSession("u1").previewId;
		const victim = ownedSession(victimId, "u1");
		await syncFiles(victim, { "v.bin": "123456" });
		clock += 10;
		const currentId = createSession("u2").previewId;
		const current = ownedSession(currentId, "u2");
		await syncFiles(current, { "c.bin": "12345678" });
		expect(getSessionForServing(victimId)).toBeNull();
		expect(getSessionForServing(currentId)).not.toBeNull();
		expect(getFile(current, "c.bin")).not.toBeNull();
	});

	it("rejects with 413 when the blobs cannot fit the global budget even after evicting others", async () => {
		configure({ limits: { ...DEFAULT_PREVIEW_SESSION_LIMITS, globalMaxBytes: 4 } });
		const session = ownedSession(createSession("u1").previewId, "u1");
		const big = bytesOf("123456");
		const staged = stageManifest(session, { "big.bin": { sha256: sha256Hex(big), size: big.length } });
		if ("status" in staged) throw new Error("unexpected error");
		const stored = await storeBlobs(session, staged.manifestId, [{ declaredSha256: sha256Hex(big), bytes: big }]);
		expect(stored).toMatchObject({ status: 413 });
	});

	it("garbage-collects blobs unreferenced by the promoted manifest", async () => {
		const session = ownedSession(createSession("u1").previewId, "u1");
		await syncFiles(session, { "index.html": "version one" });
		const bytesBefore = getStats().globalBytes;
		await syncFiles(session, { "index.html": "version two!" });
		expect(getFile(session, "index.html")?.bytes).toEqual(bytesOf("version two!"));
		// The old blob is unreferenced after the swap and must be reclaimed.
		expect(session.blobs.size).toBe(1);
		expect(getStats().globalBytes).toBe(bytesOf("version two!").length);
		expect(bytesBefore).toBe(bytesOf("version one").length);
	});

	it("keeps serving the previous manifest until the new one fully promotes (atomicity)", async () => {
		const session = ownedSession(createSession("u1").previewId, "u1");
		await syncFiles(session, { "index.html": "old page", "theme/style.css": "old css" });

		// Gate the injected hasher so the storeBlobs await is interleaved with GETs.
		let releaseHash: () => void = () => {};
		const gate = new Promise<void>((resolve) => {
			releaseHash = resolve;
		});
		const realHash = (bytes: Uint8Array) => Promise.resolve(sha256Hex(bytes));
		configure({
			sha256: async (bytes: Uint8Array) => {
				await gate;
				return realHash(bytes);
			},
		});

		const newIndex = bytesOf("new page");
		const newCss = bytesOf("new css");
		const staged = stageManifest(session, {
			"index.html": { sha256: sha256Hex(newIndex), size: newIndex.length },
			"theme/style.css": { sha256: sha256Hex(newCss), size: newCss.length },
		});
		if ("status" in staged) throw new Error("unexpected error");

		const uploading = storeBlobs(session, staged.manifestId, [
			{ declaredSha256: sha256Hex(newIndex), bytes: newIndex },
			{ declaredSha256: sha256Hex(newCss), bytes: newCss },
		]);

		// Mid-upload: the old manifest must still serve completely.
		expect(getFile(session, "index.html")?.bytes).toEqual(bytesOf("old page"));
		expect(getFile(session, "theme/style.css")?.bytes).toEqual(bytesOf("old css"));

		releaseHash();
		const stored = await uploading;
		if ("status" in stored) throw new Error("unexpected error");
		expect(stored.active).toBe(true);
		expect(getFile(session, "index.html")?.bytes).toEqual(newIndex);
		expect(getFile(session, "theme/style.css")?.bytes).toEqual(newCss);
	});
});

describe("getFile", () => {
	it("serves normalized paths with content type and html flag from the active manifest only", async () => {
		const session = ownedSession(createSession("u1").previewId, "u1");
		await syncFiles(session, {
			"index.html": "<html></html>",
			"theme/style.css": "body{}",
		});
		expect(getFile(session, "")).toMatchObject({ isHtml: true, contentType: "text/html; charset=utf-8" });
		expect(getFile(session, "/index.html?exe-teacher=1")).not.toBeNull();
		expect(getFile(session, "theme/style.css")).toMatchObject({
			isHtml: false,
			contentType: "text/css; charset=utf-8",
		});
	});

	it("returns null before any manifest is promoted (pending only)", () => {
		const session = ownedSession(createSession("u1").previewId, "u1");
		const bytes = bytesOf("<html></html>");
		const staged = stageManifest(session, { "index.html": { sha256: sha256Hex(bytes), size: bytes.length } });
		if ("status" in staged) throw new Error("unexpected error");
		expect(staged.active).toBe(false);
		expect(getFile(session, "index.html")).toBeNull();
	});

	it("returns null for unknown and traversal paths", async () => {
		const session = ownedSession(createSession("u1").previewId, "u1");
		await syncFiles(session, { "index.html": "x" });
		expect(getFile(session, "missing.html")).toBeNull();
		expect(getFile(session, "../index.html")).toBeNull();
		expect(getFile(session, "%2e%2e%2findex.html")).toBeNull();
		expect(getFile(session, "%00")).toBeNull();
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
