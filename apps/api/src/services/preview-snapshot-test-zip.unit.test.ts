import { describe, expect, test } from "bun:test";
import { readSnapshotArchive } from "./preview-snapshot-archive.ts";
import { buildSimpleZip, buildZip } from "./preview-snapshot-test-zip.ts";

const LIMITS = { maxFiles: 100, maxBytes: 1024 * 1024 };
const utf8 = new TextDecoder();

/**
 * The fixture builder is only useful if the reader can actually read what it
 * writes, so these are round-trip tests: build → read → compare.
 */
describe("preview snapshot test ZIP builder", () => {
	test("round-trips stored entries", async () => {
		const zip = await buildSimpleZip({
			"index.html": "<html>hi</html>",
			"assets/app.js": "run()",
		});

		const result = await readSnapshotArchive(zip, LIMITS);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(utf8.decode(result.files.get("index.html"))).toBe("<html>hi</html>");
		expect(utf8.decode(result.files.get("assets/app.js"))).toBe("run()");
	});

	test("round-trips deflated entries", async () => {
		const body = "x".repeat(5000);
		const zip = await buildZip([
			{ name: "index.html", content: body, deflate: true },
		]);

		const result = await readSnapshotArchive(zip, LIMITS);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(utf8.decode(result.files.get("index.html"))).toBe(body);
	});

	test("can forge an archive that under-reports its own size", async () => {
		const zip = await buildZip([
			{
				name: "index.html",
				content: "x".repeat(4096),
				deflate: true,
				declaredSize: 1,
			},
		]);

		// The declared size is a lie, so a reader that trusted the central
		// directory would happily accept this. The real bytes are what matter.
		const result = await readSnapshotArchive(zip, {
			maxFiles: 100,
			maxBytes: 64,
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe("too-large");
	});

	test("preserves binary content byte for byte", async () => {
		const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
		const zip = await buildZip([
			{ name: "index.html", content: "ok" },
			{ name: "img/x.png", content: bytes },
		]);

		const result = await readSnapshotArchive(zip, LIMITS);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect([...(result.files.get("img/x.png") ?? [])]).toEqual([...bytes]);
	});
});
