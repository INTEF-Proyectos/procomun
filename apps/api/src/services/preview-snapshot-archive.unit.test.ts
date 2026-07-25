import { describe, expect, test } from "bun:test";
import { readSnapshotArchive } from "./preview-snapshot-archive.ts";
import { buildSimpleZip, buildZip } from "./preview-snapshot-test-zip.ts";

const LIMITS = { maxFiles: 100, maxBytes: 1024 * 1024 };

describe("readSnapshotArchive", () => {
	test("unpacks a well-formed archive", async () => {
		const zip = await buildSimpleZip({
			"index.html": "<html>hi</html>",
			"style/main.css": "body{}",
		});

		const result = await readSnapshotArchive(zip, LIMITS);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect([...result.files.keys()].sort()).toEqual([
			"index.html",
			"style/main.css",
		]);
		expect(result.bytes).toBe("<html>hi</html>".length + "body{}".length);
	});

	test("skips directory entries rather than rejecting them", async () => {
		const zip = await buildZip([
			{ name: "assets/", content: "" },
			{ name: "index.html", content: "ok" },
		]);

		const result = await readSnapshotArchive(zip, LIMITS);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect([...result.files.keys()]).toEqual(["index.html"]);
	});

	test("requires an index.html", async () => {
		const zip = await buildSimpleZip({ "page.html": "orphan" });

		const result = await readSnapshotArchive(zip, LIMITS);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("missing-index");
	});

	/**
	 * The whole archive is refused, not just the offending entry — and before a
	 * single byte is inflated, so a traversal never reaches the file map. The
	 * rule itself is `isUnsafeZipEntry` from elpx-safe-extract.ts, shared with
	 * the .elpx upload path; these cases prove it is actually applied here.
	 */
	test.each([
		["../escape.html", "traversal"],
		["/etc/passwd", "absolute"],
		["win\\path.html", "backslash"],
		["file:///etc/passwd", "scheme"],
	])("one unsafe path (%s: %s) rejects the whole archive", async (name) => {
		const zip = await buildZip([
			{ name: "index.html", content: "ok" },
			{ name, content: "nope" },
		]);

		const result = await readSnapshotArchive(zip, LIMITS);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("unsafe-path");
	});

	test("enforces the entry-count cap", async () => {
		const zip = await buildSimpleZip({
			"index.html": "a",
			"b.html": "b",
			"c.html": "c",
		});

		const result = await readSnapshotArchive(zip, {
			maxFiles: 2,
			maxBytes: 1024,
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("too-many-files");
	});

	test("rejects an honestly-declared oversized archive up front", async () => {
		const zip = await buildSimpleZip({ "index.html": "x".repeat(512) });

		const result = await readSnapshotArchive(zip, {
			maxFiles: 10,
			maxBytes: 64,
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("too-large");
	});

	/**
	 * The bomb case: sizes in the central directory are attacker-supplied, so the
	 * cap has to hold on the bytes that actually come out of the inflater.
	 */
	test("enforces the byte cap on real inflated bytes, not declared ones", async () => {
		const zip = await buildZip([
			{
				name: "index.html",
				content: "x".repeat(200_000),
				deflate: true,
				declaredSize: 10,
			},
		]);

		const result = await readSnapshotArchive(zip, {
			maxFiles: 10,
			maxBytes: 1000,
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("too-large");
	});

	test("rejects an unsupported compression method", async () => {
		const zip = await buildSimpleZip({ "index.html": "ok" });
		// Patch the central-directory method field (offset 10 within the record)
		// to 12 (bzip2), which this reader does not implement.
		const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
		let cd = -1;
		for (let i = 0; i < zip.length - 4; i++) {
			if (view.getUint32(i, true) === 0x02014b50) {
				cd = i;
				break;
			}
		}
		expect(cd).toBeGreaterThan(-1);
		view.setUint16(cd + 10, 12, true);

		const result = await readSnapshotArchive(zip, LIMITS);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("unsupported-compression");
	});

	test.each([
		[new Uint8Array(0), "empty"],
		[new Uint8Array(64), "no EOCD"],
	])("rejects a non-ZIP body (%#: %s)", async (body) => {
		const result = await readSnapshotArchive(body, LIMITS);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("invalid-zip");
	});
});
