/**
 * The trust boundary for an uploaded preview snapshot: turns one ZIP of
 * untrusted author content into a vetted `path → bytes` map, or refuses it.
 *
 * Kept apart from the store on purpose — the store's job is to publish a
 * snapshot and bound what the process holds, this one's is to decide whether an
 * archive may be unpacked at all. These rules are what stands between author
 * content and the API process, so they are worth reading in one place.
 *
 * Two passes, and the order matters:
 *
 *  1. The central directory is read and EVERY entry is vetted before anything is
 *     decompressed — a limit noticed halfway through would mean work already
 *     done on behalf of an archive we were always going to reject.
 *  2. Entries are inflated one at a time and the bytes that ACTUALLY come out
 *     are counted. The uncompressed sizes in a ZIP's central directory are
 *     supplied by whoever built the archive, so pass 1's total is an early
 *     reject, never the enforcement — a zip bomb that under-declares its sizes
 *     is caught here instead.
 *
 * ZIP parsing follows the same central-directory approach as the frontend's
 * `elpx-browser.ts` (robust against data descriptors) and inflates with the
 * standard `DecompressionStream`, so this adds no dependency.
 */

/** Why an archive was refused. The store maps these onto HTTP statuses. */
export type SnapshotArchiveError =
	| { code: "invalid-zip"; message: string }
	| { code: "unsafe-path"; message: string }
	| { code: "too-many-files"; message: string }
	| { code: "too-large"; message: string }
	| { code: "missing-index"; message: string }
	| { code: "unsupported-compression"; message: string };

export type SnapshotArchiveResult =
	| { ok: true; files: Map<string, Uint8Array>; bytes: number }
	| { ok: false; error: SnapshotArchiveError };

export interface SnapshotArchiveLimits {
	maxFiles: number;
	maxBytes: number;
}

interface CentralDirEntry {
	name: string;
	method: number;
	compressedSize: number;
	uncompressedSize: number;
	localHeaderOffset: number;
}

const utf8 = new TextDecoder();

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/**
 * Whether a ZIP entry name is a canonical, safe relative path.
 *
 * There is deliberately no reserved-name list: the store keeps a snapshot's
 * metadata outside the file map, so no author path can collide with it.
 */
export function isSafeEntryPath(name: string): boolean {
	if (name === "" || name.includes("\0") || name.includes("\\")) return false;
	if (name.startsWith("/")) return false;
	// A drive-letter or scheme prefix is never a relative path.
	if (/^[a-zA-Z]:/.test(name) || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(name)) {
		return false;
	}
	for (const segment of name.split("/")) {
		if (segment === "" || segment === "." || segment === "..") return false;
	}
	return true;
}

/** Find the End Of Central Directory record by scanning backwards. */
function findEocd(buf: Uint8Array, view: DataView): number {
	for (let i = buf.length - 22; i >= 0 && i >= buf.length - 65536; i--) {
		if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
	}
	return -1;
}

/** Read the central directory entries. */
function parseCentralDirectory(
	buf: Uint8Array,
	view: DataView,
	eocdOffset: number,
): CentralDirEntry[] {
	const cdOffset = view.getUint32(eocdOffset + 16, true);
	const cdCount = view.getUint16(eocdOffset + 10, true);
	const entries: CentralDirEntry[] = [];
	let pos = cdOffset;

	for (let i = 0; i < cdCount; i++) {
		if (pos + 46 > buf.length) break;
		if (view.getUint32(pos, true) !== CENTRAL_DIR_SIGNATURE) break;
		const nameLen = view.getUint16(pos + 28, true);
		const extraLen = view.getUint16(pos + 30, true);
		const commentLen = view.getUint16(pos + 32, true);
		entries.push({
			name: utf8.decode(buf.slice(pos + 46, pos + 46 + nameLen)),
			method: view.getUint16(pos + 10, true),
			compressedSize: view.getUint32(pos + 20, true),
			uncompressedSize: view.getUint32(pos + 24, true),
			localHeaderOffset: view.getUint32(pos + 42, true),
		});
		pos += 46 + nameLen + extraLen + commentLen;
	}
	return entries;
}

/** Slice an entry's raw (still compressed) bytes out of its local header. */
function rawEntryData(
	buf: Uint8Array,
	view: DataView,
	entry: CentralDirEntry,
): Uint8Array | null {
	const header = entry.localHeaderOffset;
	if (header + 30 > buf.length) return null;
	const nameLen = view.getUint16(header + 26, true);
	const extraLen = view.getUint16(header + 28, true);
	const start = header + 30 + nameLen + extraLen;
	const end = start + entry.compressedSize;
	if (end > buf.length) return null;
	return buf.slice(start, end);
}

/** Inflate raw deflate data with the standard DecompressionStream. */
async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
	const stream = new DecompressionStream("deflate-raw");
	const writer = stream.writable.getWriter();
	// slice() copies into a fresh ArrayBuffer-backed view, which the stream
	// APIs require under strict TS libs.
	void writer.write(data.slice());
	void writer.close();

	const reader = stream.readable.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		total += value.length;
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
}

/**
 * Vet and unpack a snapshot archive.
 *
 * Directory entries are skipped rather than rejected: a ZIP may or may not
 * carry them, and the resulting file map has no directories to create.
 */
export async function readSnapshotArchive(
	zip: Uint8Array,
	limits: SnapshotArchiveLimits,
): Promise<SnapshotArchiveResult> {
	if (zip.length < 22) {
		return fail("invalid-zip", "Preview archive is not a ZIP file.");
	}
	const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
	const eocd = findEocd(zip, view);
	if (eocd < 0) {
		return fail("invalid-zip", "Preview archive is not a ZIP file.");
	}
	const entries = parseCentralDirectory(zip, view, eocd).filter(
		(entry) => !entry.name.endsWith("/"),
	);

	// --- Pass 1: vet every entry before decompressing anything ---------------
	if (entries.length > limits.maxFiles) {
		return fail("too-many-files", "Preview archive contains too many files.");
	}
	let declared = 0;
	let hasIndex = false;
	for (const entry of entries) {
		if (!isSafeEntryPath(entry.name)) {
			return fail("unsafe-path", "Unsafe path in the preview archive.");
		}
		if (entry.method !== METHOD_STORED && entry.method !== METHOD_DEFLATE) {
			return fail(
				"unsupported-compression",
				`Unsupported compression method: ${entry.method}`,
			);
		}
		declared += entry.uncompressedSize;
		if (declared > limits.maxBytes) {
			return fail("too-large", "Preview archive is too large.");
		}
		hasIndex ||= entry.name === "index.html";
	}
	if (!hasIndex) {
		return fail("missing-index", "Preview archive must contain index.html.");
	}

	// --- Pass 2: inflate, counting the bytes that actually come out ----------
	const files = new Map<string, Uint8Array>();
	let bytes = 0;
	for (const entry of entries) {
		const raw = rawEntryData(zip, view, entry);
		if (raw === null) {
			return fail("invalid-zip", "Preview archive is truncated.");
		}
		let content: Uint8Array;
		try {
			content = entry.method === METHOD_STORED ? raw : await inflateRaw(raw);
		} catch {
			return fail("invalid-zip", "Preview archive could not be decompressed.");
		}
		bytes += content.length;
		if (bytes > limits.maxBytes) {
			return fail("too-large", "Preview archive is too large.");
		}
		files.set(entry.name, content);
	}

	return { ok: true, files, bytes };
}

function fail(
	code: SnapshotArchiveError["code"],
	message: string,
): SnapshotArchiveResult {
	return { ok: false, error: { code, message } };
}
