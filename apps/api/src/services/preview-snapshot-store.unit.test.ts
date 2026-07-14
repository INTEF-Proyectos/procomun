import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { PreviewSnapshotError, PreviewSnapshotStore } from "./preview-snapshot-store.ts";

function archive(files: Record<string, string>): Uint8Array {
	return zipSync(Object.fromEntries(Object.entries(files).map(([path, value]) => [path, strToU8(value)])));
}

describe("PreviewSnapshotStore", () => {
	test("atomically creates and replaces a complete project-scoped snapshot", async () => {
		const store = new PreviewSnapshotStore();
		const id = await store.replace({ ownerId: "user-a", projectId: "project-a", archive: archive({ "index.html": "first" }) });
		const sameId = await store.replace({ ownerId: "user-a", projectId: "project-a", previewId: id, archive: archive({ "index.html": "second", "app.js": "run()" }) });
		expect(sameId).toBe(id);
		expect(new TextDecoder().decode(store.get(id, "index.html")?.bytes)).toBe("second");
		expect(store.get(id, "app.js")?.contentType).toContain("application/javascript");
	});

	test("rejects traversal, missing entry points, and cross-project updates", async () => {
		const store = new PreviewSnapshotStore();
		await expect(store.replace({ ownerId: "u", projectId: "p", archive: archive({ "page.html": "no index" }) })).rejects.toBeInstanceOf(PreviewSnapshotError);
		await expect(store.replace({ ownerId: "u", projectId: "p", archive: archive({ "../index.html": "escape" }) })).rejects.toBeInstanceOf(PreviewSnapshotError);
		const id = await store.replace({ ownerId: "u", projectId: "p", archive: archive({ "index.html": "ok" }) });
		await expect(store.replace({ ownerId: "other", projectId: "p", previewId: id, archive: archive({ "index.html": "bad" }) })).rejects.toMatchObject({ code: "forbidden" });
		expect(store.get(id, "../index.html")).toBeNull();
	});

	test("expires idle capabilities and enforces owner-scoped deletion", async () => {
		let now = 1_000;
		const store = new PreviewSnapshotStore(100, () => now);
		const id = await store.replace({ ownerId: "u", projectId: "p", archive: archive({ "index.html": "ok" }) });
		expect(() => store.delete("other", "p", id)).toThrow();
		now = 1_101;
		expect(store.get(id, "index.html")).toBeNull();
		expect(store.delete("u", "p", id)).toBe(false);
	});
});
