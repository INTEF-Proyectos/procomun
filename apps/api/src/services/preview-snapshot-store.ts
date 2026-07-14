import { unzip } from "fflate";
import { inspectZipEntries } from "./elpx-safe-extract.ts";

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 5_000;

type SnapshotFile = { bytes: Uint8Array; contentType: string };
type Snapshot = {
	id: string;
	ownerId: string;
	projectId: string;
	files: Map<string, SnapshotFile>;
	accessedAt: number;
};

export class PreviewSnapshotError extends Error {
	constructor(message: string, readonly code: "invalid" | "forbidden" | "not-found" | "too-large") {
		super(message);
	}
}

function normalizePath(value: string): string {
	let decoded: string;
	try {
		decoded = decodeURIComponent(value);
	} catch {
		throw new PreviewSnapshotError("Invalid preview path", "invalid");
	}
	if (!decoded || decoded.startsWith("/") || decoded.includes("\\") || decoded.split("/").some((part) => part === "" || part === "." || part === "..")) {
		throw new PreviewSnapshotError("Invalid preview path", "invalid");
	}
	return decoded;
}

function contentType(path: string): string {
	const extension = path.split(".").pop()?.toLowerCase();
	return ({
		html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8", xhtml: "application/xhtml+xml",
		xml: "application/xml", svg: "image/svg+xml", css: "text/css; charset=utf-8",
		js: "application/javascript; charset=utf-8", mjs: "application/javascript; charset=utf-8",
		json: "application/json; charset=utf-8", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
		gif: "image/gif", webp: "image/webp", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg",
		ogg: "audio/ogg", pdf: "application/pdf", woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf",
	} as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}

async function extractSnapshot(archive: Uint8Array): Promise<Map<string, SnapshotFile>> {
	if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new PreviewSnapshotError("Preview snapshot is too large", "too-large");
	try {
		inspectZipEntries(Buffer.from(archive), {
			maxEntries: MAX_FILES,
			maxTotalUncompressed: MAX_UNCOMPRESSED_BYTES,
			maxCompressionRatio: 500,
		});
	} catch (error) {
		throw new PreviewSnapshotError(error instanceof Error ? error.message : "Invalid ZIP snapshot", "invalid");
	}
	const extracted = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
		unzip(archive, (error, files) => (error ? reject(error) : resolve(files)));
	});
	const files = new Map<string, SnapshotFile>();
	for (const [rawPath, bytes] of Object.entries(extracted)) {
		if (rawPath.endsWith("/")) continue;
		const path = normalizePath(rawPath);
		files.set(path, { bytes, contentType: contentType(path) });
	}
	if (!files.has("index.html")) throw new PreviewSnapshotError("Preview snapshot must contain index.html", "invalid");
	return files;
}

export class PreviewSnapshotStore {
	private readonly snapshots = new Map<string, Snapshot>();

	constructor(private readonly ttlMs = DEFAULT_TTL_MS, private readonly now: () => number = Date.now) {}

	async replace(input: { ownerId: string; projectId: string; previewId?: string; archive: Uint8Array }): Promise<string> {
		this.reapExpired();
		const existing = input.previewId ? this.snapshots.get(input.previewId) : undefined;
		if (input.previewId && !existing) throw new PreviewSnapshotError("Preview snapshot not found", "not-found");
		if (existing && (existing.ownerId !== input.ownerId || existing.projectId !== input.projectId)) {
			throw new PreviewSnapshotError("Preview snapshot is owned by another project", "forbidden");
		}
		const files = await extractSnapshot(input.archive);
		const id = existing?.id ?? crypto.randomUUID();
		this.snapshots.set(id, { id, ownerId: input.ownerId, projectId: input.projectId, files, accessedAt: this.now() });
		return id;
	}

	get(previewId: string, path: string): SnapshotFile | null {
		this.reapExpired();
		const snapshot = this.snapshots.get(previewId);
		if (!snapshot) return null;
		let normalized: string;
		try { normalized = normalizePath(path || "index.html"); } catch { return null; }
		const file = snapshot.files.get(normalized);
		if (!file) return null;
		snapshot.accessedAt = this.now();
		return file;
	}

	delete(ownerId: string, projectId: string, previewId: string): boolean {
		this.reapExpired();
		const snapshot = this.snapshots.get(previewId);
		if (!snapshot) return false;
		if (snapshot.ownerId !== ownerId || snapshot.projectId !== projectId) {
			throw new PreviewSnapshotError("Preview snapshot is owned by another project", "forbidden");
		}
		return this.snapshots.delete(previewId);
	}

	reapExpired(): number {
		const cutoff = this.now() - this.ttlMs;
		let removed = 0;
		for (const [id, snapshot] of this.snapshots) {
			if (snapshot.accessedAt <= cutoff) { this.snapshots.delete(id); removed++; }
		}
		return removed;
	}
}

export const previewSnapshotStore = new PreviewSnapshotStore();
