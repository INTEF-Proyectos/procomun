import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	configure,
	DEFAULT_PREVIEW_SNAPSHOT_LIMITS,
	deleteSnapshot,
	evaluatePreviewReplicaConfig,
	getFile,
	getLimitsFromEnv,
	getOwnedSnapshot,
	getSnapshotForServing,
	getStats,
	normalizeContentPath,
	replaceSnapshot,
	resetDependencies,
	sweepExpired,
} from "./preview-snapshot-store.ts";
import { buildSimpleZip } from "./preview-snapshot-test-zip.ts";

const utf8 = new TextDecoder();
let now = 1_000_000;

beforeEach(() => {
	resetDependencies();
	now = 1_000_000;
	configure({ now: () => now });
});

afterEach(() => {
	resetDependencies();
});

/** Publish a snapshot and return its capability id, failing loudly otherwise. */
async function publish(
	owner: string,
	files: Record<string, string>,
	previewId?: string,
): Promise<string> {
	const result = await replaceSnapshot(
		owner,
		await buildSimpleZip(files),
		previewId,
	);
	if (!result.ok) throw new Error(`publish failed: ${result.error}`);
	return result.previewId;
}

describe("publishing", () => {
	test("mints a capability and serves the archive", async () => {
		const id = await publish("alice", {
			"index.html": "hello",
			"assets/app.js": "run()",
		});

		const snapshot = getSnapshotForServing(id);
		expect(snapshot).not.toBeNull();
		if (!snapshot) return;
		expect(utf8.decode(getFile(snapshot, "index.html")?.bytes)).toBe("hello");
		expect(utf8.decode(getFile(snapshot, "assets/app.js")?.bytes)).toBe(
			"run()",
		);
	});

	test("replacing in place swaps the WHOLE file map", async () => {
		const id = await publish("alice", {
			"index.html": "first",
			"stale.html": "gone next time",
		});

		const again = await publish("alice", { "index.html": "second" }, id);

		expect(again).toBe(id);
		const snapshot = getSnapshotForServing(id);
		if (!snapshot) throw new Error("expected a live snapshot");
		expect(utf8.decode(getFile(snapshot, "index.html")?.bytes)).toBe("second");
		expect(getFile(snapshot, "stale.html")).toBeNull();
	});

	/**
	 * A replacement keeps the capability id, so an ETag derived from the id alone
	 * would let a conditional request answer 304 with the previous bytes.
	 */
	test("replacing changes the ETag", async () => {
		const id = await publish("alice", {
			"index.html": "ok",
			"img/logo.png": "v1",
		});
		const before = getFile(
			getSnapshotForServing(id) ?? throwMissing(),
			"img/logo.png",
		)?.etag;

		await publish("alice", { "index.html": "ok", "img/logo.png": "v2" }, id);
		const after = getFile(
			getSnapshotForServing(id) ?? throwMissing(),
			"img/logo.png",
		)?.etag;

		expect(before).toBeDefined();
		expect(after).not.toBe(before);
	});

	test("refuses a capability owned by another user", async () => {
		const id = await publish("alice", { "index.html": "hers" });

		const result = await replaceSnapshot(
			"mallory",
			await buildSimpleZip({ "index.html": "theirs" }),
			id,
		);

		expect(result).toMatchObject({ ok: false, status: 403 });
		const snapshot = getSnapshotForServing(id);
		if (!snapshot) throw new Error("expected a live snapshot");
		expect(utf8.decode(getFile(snapshot, "index.html")?.bytes)).toBe("hers");
	});

	test("refuses an unknown capability", async () => {
		const result = await replaceSnapshot(
			"alice",
			await buildSimpleZip({ "index.html": "ok" }),
			"ffffffff-ffff-4fff-bfff-ffffffffffff",
		);

		expect(result).toMatchObject({ ok: false, status: 404 });
	});

	test("a rejected archive leaves the previous snapshot intact", async () => {
		const id = await publish("alice", { "index.html": "good" });

		const result = await replaceSnapshot(
			"alice",
			await buildSimpleZip({ "page.html": "no index" }),
			id,
		);

		expect(result).toMatchObject({ ok: false, status: 400 });
		const snapshot = getSnapshotForServing(id);
		if (!snapshot) throw new Error("expected a live snapshot");
		expect(utf8.decode(getFile(snapshot, "index.html")?.bytes)).toBe("good");
	});
});

describe("ownership", () => {
	test("getOwnedSnapshot gates by owner", async () => {
		const id = await publish("alice", { "index.html": "ok" });

		expect(getOwnedSnapshot(id, "mallory")).toEqual({ status: 403 });
		expect(getOwnedSnapshot("no-such-id", "alice")).toEqual({ status: 404 });
		expect("snapshot" in getOwnedSnapshot(id, "alice")).toBe(true);
	});

	test("deleteSnapshot frees the global budget", async () => {
		const id = await publish("alice", { "index.html": "ok" });
		expect(getStats().globalBytes).toBeGreaterThan(0);

		expect(deleteSnapshot(id)).toBe(true);

		expect(getStats()).toEqual({ snapshots: 0, globalBytes: 0 });
	});
});

describe("TTL and budgets", () => {
	test("idle snapshots are swept", async () => {
		const id = await publish("alice", { "index.html": "ok" });

		now += DEFAULT_PREVIEW_SNAPSHOT_LIMITS.ttlMs + 1000;

		expect(sweepExpired()).toBe(1);
		expect(getSnapshotForServing(id)).toBeNull();
		expect(getStats().globalBytes).toBe(0);
	});

	test("serving pushes the idle clock back", async () => {
		const id = await publish("alice", { "index.html": "ok" });

		now += DEFAULT_PREVIEW_SNAPSHOT_LIMITS.ttlMs - 1000;
		expect(getSnapshotForServing(id)).not.toBeNull();

		now += 2000;
		expect(sweepExpired()).toBe(0);
		expect(getSnapshotForServing(id)).not.toBeNull();
	});

	test("the per-user cap evicts that user's least-recently-used snapshot", async () => {
		configure({
			limits: { ...DEFAULT_PREVIEW_SNAPSHOT_LIMITS, maxSnapshotsPerUser: 2 },
		});
		const first = await publish("alice", { "index.html": "1" });
		now += 10;
		const second = await publish("alice", { "index.html": "2" });
		now += 10;

		const third = await publish("alice", { "index.html": "3" });

		expect(getSnapshotForServing(first)).toBeNull();
		expect(getSnapshotForServing(second)).not.toBeNull();
		expect(getSnapshotForServing(third)).not.toBeNull();
	});

	test("the per-user cap never touches another user's snapshots", async () => {
		configure({
			limits: { ...DEFAULT_PREVIEW_SNAPSHOT_LIMITS, maxSnapshotsPerUser: 1 },
		});
		const hers = await publish("alice", { "index.html": "hers" });
		now += 10;

		await publish("bob", { "index.html": "his" });

		expect(getSnapshotForServing(hers)).not.toBeNull();
	});

	test("the global budget evicts other snapshots LRU-first", async () => {
		configure({
			limits: {
				...DEFAULT_PREVIEW_SNAPSHOT_LIMITS,
				globalMaxBytes: 40,
				maxSnapshotsPerUser: 10,
			},
		});
		const old = await publish("alice", { "index.html": "x".repeat(20) });
		now += 10;

		const fresh = await publish("bob", { "index.html": "y".repeat(30) });

		expect(getSnapshotForServing(old)).toBeNull();
		expect(getSnapshotForServing(fresh)).not.toBeNull();
	});

	test("an archive that cannot fit the global budget at all is refused", async () => {
		configure({
			limits: { ...DEFAULT_PREVIEW_SNAPSHOT_LIMITS, globalMaxBytes: 4 },
		});

		const result = await replaceSnapshot(
			"alice",
			await buildSimpleZip({ "index.html": "x".repeat(64) }),
		);

		expect(result).toMatchObject({ ok: false, status: 413 });
	});

	/** Replacing must be measured against the outgoing snapshot, not on top of it. */
	test("replacing in place does not double-count against the budget", async () => {
		configure({
			limits: { ...DEFAULT_PREVIEW_SNAPSHOT_LIMITS, globalMaxBytes: 60 },
		});
		const id = await publish("alice", { "index.html": "x".repeat(40) });

		const again = await replaceSnapshot(
			"alice",
			await buildSimpleZip({ "index.html": "y".repeat(40) }),
			id,
		);

		expect(again).toMatchObject({ ok: true, previewId: id });
		expect(getStats().globalBytes).toBe(40);
	});
});

describe("serving lookups", () => {
	test("classifies scriptable documents and plain assets", async () => {
		const id = await publish("alice", {
			"index.html": "<html></html>",
			"img/inline.svg": "<svg></svg>",
			"img/photo.png": "binary",
		});
		const snapshot = getSnapshotForServing(id) ?? throwMissing();

		expect(getFile(snapshot, "index.html")).toMatchObject({
			kind: "document",
			isScriptable: true,
			contentType: "text/html; charset=utf-8",
		});
		expect(getFile(snapshot, "img/inline.svg")).toMatchObject({
			kind: "document",
			isScriptable: true,
		});
		expect(getFile(snapshot, "img/photo.png")).toMatchObject({
			kind: "asset",
			isScriptable: false,
			contentType: "image/png",
		});
	});

	test("an empty path resolves to index.html", async () => {
		const id = await publish("alice", { "index.html": "root" });
		const snapshot = getSnapshotForServing(id) ?? throwMissing();

		expect(utf8.decode(getFile(snapshot, "")?.bytes)).toBe("root");
	});

	test.each([
		["../secret"],
		["%2e%2e%2fsecret"],
		["a/../../secret"],
	])("refuses traversal %s", async (attempt) => {
		const id = await publish("alice", { "index.html": "ok" });
		const snapshot = getSnapshotForServing(id) ?? throwMissing();

		expect(getFile(snapshot, attempt)).toBeNull();
	});

	test("an unknown path misses", async () => {
		const id = await publish("alice", { "index.html": "ok" });
		const snapshot = getSnapshotForServing(id) ?? throwMissing();

		expect(getFile(snapshot, "nope.css")).toBeNull();
	});
});

describe("configuration carried over from the session store", () => {
	test("normalizeContentPath still defaults to index.html", () => {
		expect(normalizeContentPath("")).toBe("index.html");
		expect(normalizeContentPath("/")).toBe("index.html");
		expect(normalizeContentPath("../x")).toBeNull();
	});

	test("limits come from the environment when set", () => {
		const limits = getLimitsFromEnv({
			PREVIEW_SESSION_TTL_MINUTES: "5",
			PREVIEW_MAX_SESSIONS_PER_USER: "2",
			PREVIEW_GLOBAL_MAX_BYTES_MB: "1",
		} as NodeJS.ProcessEnv);

		expect(limits.ttlMs).toBe(5 * 60_000);
		expect(limits.maxSnapshotsPerUser).toBe(2);
		expect(limits.globalMaxBytes).toBe(1024 * 1024);
	});

	test("invalid env values fall back to the defaults", () => {
		const limits = getLimitsFromEnv({
			PREVIEW_SESSION_TTL_MINUTES: "-1",
			PREVIEW_MAX_SESSIONS_PER_USER: "not-a-number",
		} as NodeJS.ProcessEnv);

		expect(limits.ttlMs).toBe(DEFAULT_PREVIEW_SNAPSHOT_LIMITS.ttlMs);
		expect(limits.maxSnapshotsPerUser).toBe(
			DEFAULT_PREVIEW_SNAPSHOT_LIMITS.maxSnapshotsPerUser,
		);
	});

	test("the replica guard only warns on an unconfirmed multi-replica setup", () => {
		expect(evaluatePreviewReplicaConfig({} as NodeJS.ProcessEnv)).toBeNull();
		expect(
			evaluatePreviewReplicaConfig({
				PREVIEW_MULTI_REPLICA: "1",
				PREVIEW_STICKY_ROUTING_CONFIRMED: "1",
			} as NodeJS.ProcessEnv),
		).toBeNull();
		expect(
			evaluatePreviewReplicaConfig({
				PREVIEW_MULTI_REPLICA: "1",
			} as NodeJS.ProcessEnv),
		).toContain("sticky routing");
	});
});

function throwMissing(): never {
	throw new Error("expected a live snapshot");
}
