/**
 * The trust boundary for an uploaded preview snapshot: turns one ZIP of
 * untrusted author content into a vetted `path → bytes` map, or refuses it.
 *
 * Parsing and entry vetting are NOT reimplemented here — `elpx-safe-extract.ts`
 * already owns the repo's ZIP rules (ported from `zip_utils.php`, so the API and
 * the PHP hosts agree): ZIP64 is refused outright, symlink entries are detected
 * through the Unix external attributes, and `isUnsafeZipEntry` is the single
 * definition of a dangerous name. Hardening either of those now reaches the
 * upload path and this one together.
 *
 * What IS new here is in-memory extraction under a real-byte budget:
 *
 *  1. Every entry is vetted before anything is inflated — a limit noticed
 *     halfway through would mean work already done on behalf of an archive we
 *     were always going to reject.
 *  2. Entries are inflated one at a time and the bytes that ACTUALLY come out
 *     are counted. The uncompressed sizes in a ZIP's central directory are
 *     supplied by whoever built the archive, so pass 1's total is an early
 *     reject, never the enforcement — a zip bomb that under-declares its sizes
 *     is caught here instead.
 *
 * Inflation uses the standard `DecompressionStream`, so this adds no dependency.
 */
import {
	isUnsafeZipEntry,
	readZipCentralDirectory,
	type ZipEntryInfo,
} from "./elpx-safe-extract.ts";

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

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/** Slice an entry's raw (still compressed) bytes out of its local header. */
function rawEntryData(
	zip: Uint8Array,
	view: DataView,
	entry: ZipEntryInfo,
): Uint8Array | null {
	const header = entry.localHeaderOffset;
	if (header + 30 > zip.length) return null;
	const nameLen = view.getUint16(header + 26, true);
	const extraLen = view.getUint16(header + 28, true);
	const start = header + 30 + nameLen + extraLen;
	const end = start + entry.compressedSize;
	if (end > zip.length) return null;
	// A view, not a copy: the bytes are either handed straight to the inflater
	// or copied once below for the stored case.
	return zip.subarray(start, end);
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
	let entries: ZipEntryInfo[];
	try {
		// A view over the same memory, so the archive is not copied to be parsed.
		entries = readZipCentralDirectory(
			Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength),
		).filter((entry) => !entry.name.endsWith("/"));
	} catch (error) {
		return fail("invalid-zip", (error as Error).message);
	}

	// --- Pass 1: vet every entry before inflating anything --------------------
	if (entries.length > limits.maxFiles) {
		return fail("too-many-files", "Preview archive contains too many files.");
	}
	let declared = 0;
	let hasIndex = false;
	for (const entry of entries) {
		if (isUnsafeZipEntry(entry.name) || entry.isSymlink) {
			return fail(
				"unsafe-path",
				`Unsafe entry in the preview archive: ${entry.name}`,
			);
		}
		if (
			entry.compressionMethod !== METHOD_STORED &&
			entry.compressionMethod !== METHOD_DEFLATE
		) {
			return fail(
				"unsupported-compression",
				`Unsupported compression method: ${entry.compressionMethod}`,
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
	const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
	const files = new Map<string, Uint8Array>();
	let bytes = 0;
	for (const entry of entries) {
		const raw = rawEntryData(zip, view, entry);
		if (raw === null) {
			return fail("invalid-zip", "Preview archive is truncated.");
		}
		let content: Uint8Array;
		try {
			// The stored branch copies so the retained bytes do not pin the whole
			// uploaded archive in memory for the snapshot's lifetime.
			content =
				entry.compressionMethod === METHOD_STORED
					? raw.slice()
					: await inflateRaw(raw);
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
