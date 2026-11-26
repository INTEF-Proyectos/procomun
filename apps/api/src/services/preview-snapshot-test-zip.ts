/**
 * Minimal ZIP writer used to build preview-snapshot fixtures in tests.
 *
 * The reader under test (`preview-snapshot-archive.ts`) parses real archives, so
 * its tests need real archives — including malformed ones no ordinary zip tool
 * would produce. Hence `declaredSize`, which writes a size into the central
 * directory that does NOT match the bytes stored: exactly the shape of a zip
 * bomb that under-reports itself, and the reason the reader counts the bytes it
 * actually inflates rather than trusting the directory.
 */

/** One entry to place in the archive. */
export interface ZipEntryInput {
	name: string;
	/** File contents. A string is encoded as UTF-8. */
	content: string | Uint8Array;
	/**
	 * Store deflated instead of stored. Needed to exercise the inflate path.
	 */
	deflate?: boolean;
	/**
	 * Override the uncompressed size written to the headers. Use only to forge
	 * an archive that lies about its own size.
	 */
	declaredSize?: number;
}

const CRC_TABLE: Uint32Array = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[i] = c >>> 0;
	}
	return table;
})();

function crc32(data: Uint8Array): number {
	let c = 0xffffffff;
	for (const byte of data) {
		c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
	}
	return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
	const stream = new CompressionStream("deflate-raw");
	const writer = stream.writable.getWriter();
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

/** Build a ZIP archive from the given entries. */
export async function buildZip(entries: ZipEntryInput[]): Promise<Uint8Array> {
	const encoder = new TextEncoder();
	const localParts: Uint8Array[] = [];
	const centralParts: Uint8Array[] = [];
	let offset = 0;
	let centralSize = 0;

	for (const entry of entries) {
		const raw =
			typeof entry.content === "string"
				? encoder.encode(entry.content)
				: entry.content;
		const stored = entry.deflate ? await deflateRaw(raw) : raw;
		const method = entry.deflate ? 8 : 0;
		const nameBytes = encoder.encode(entry.name);
		const declaredSize = entry.declaredSize ?? raw.length;
		const crc = crc32(raw);

		const local = new Uint8Array(30 + nameBytes.length + stored.length);
		const localView = new DataView(local.buffer);
		localView.setUint32(0, 0x04034b50, true);
		localView.setUint16(4, 20, true); // version needed
		localView.setUint16(6, 0, true); // flags
		localView.setUint16(8, method, true);
		localView.setUint32(14, crc, true);
		localView.setUint32(18, stored.length, true);
		localView.setUint32(22, declaredSize, true);
		localView.setUint16(26, nameBytes.length, true);
		localView.setUint16(28, 0, true); // extra length
		local.set(nameBytes, 30);
		local.set(stored, 30 + nameBytes.length);
		localParts.push(local);

		const central = new Uint8Array(46 + nameBytes.length);
		const centralView = new DataView(central.buffer);
		centralView.setUint32(0, 0x02014b50, true);
		centralView.setUint16(4, 20, true); // version made by
		centralView.setUint16(6, 20, true); // version needed
		centralView.setUint16(8, 0, true); // flags
		centralView.setUint16(10, method, true);
		centralView.setUint32(16, crc, true);
		centralView.setUint32(20, stored.length, true);
		centralView.setUint32(24, declaredSize, true);
		centralView.setUint16(28, nameBytes.length, true);
		centralView.setUint32(42, offset, true);
		central.set(nameBytes, 46);
		centralParts.push(central);

		offset += local.length;
		centralSize += central.length;
	}

	const eocd = new Uint8Array(22);
	const eocdView = new DataView(eocd.buffer);
	eocdView.setUint32(0, 0x06054b50, true);
	eocdView.setUint16(8, entries.length, true);
	eocdView.setUint16(10, entries.length, true);
	eocdView.setUint32(12, centralSize, true);
	eocdView.setUint32(16, offset, true);

	const total =
		localParts.reduce((n, p) => n + p.length, 0) + centralSize + eocd.length;
	const out = new Uint8Array(total);
	let pos = 0;
	for (const part of [...localParts, ...centralParts, eocd]) {
		out.set(part, pos);
		pos += part.length;
	}
	return out;
}

/** Convenience: build a ZIP from a `path → contents` map, stored uncompressed. */
export function buildSimpleZip(
	files: Record<string, string | Uint8Array>,
): Promise<Uint8Array> {
	return buildZip(
		Object.entries(files).map(([name, content]) => ({ name, content })),
	);
}
