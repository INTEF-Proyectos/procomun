import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	DEFAULT_ELPX_EXTRACT_LIMITS,
	safeExtractElpx,
} from "./elpx-safe-extract.ts";

const CDFH_SIGNATURE = Buffer.from([0x50, 0x4b, 0x01, 0x02]);

async function pathExists(target: string): Promise<boolean> {
	try {
		await access(target);
		return true;
	} catch {
		return false;
	}
}

async function createCompressedZip(
	zipPath: string,
	size: number,
): Promise<void> {
	const script = `
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("payload.bin", b"\\0" * int(sys.argv[2]))
`;
	const proc = Bun.spawn(["python3", "-c", script, zipPath, String(size)], {
		stdout: "ignore",
		stderr: "pipe",
	});
	if ((await proc.exited) !== 0) {
		throw new Error(await new Response(proc.stderr).text());
	}
}

let tempDir: string;

beforeAll(async () => {
	tempDir = await mkdtemp(path.join(tmpdir(), "elpx-stream-limit-"));
});

afterAll(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

describe("safeExtractElpx streaming byte limit", () => {
	test("stops a forged-size zip bomb before it can remain materialized", async () => {
		const zipPath = path.join(tempDir, "forged-size.elpx");
		await createCompressedZip(zipPath, 64 * 1024);

		// Forge the central-directory uncompressed size to zero. The old
		// implementation trusted this pre-check and only measured after `unzip`
		// had already materialized the full payload.
		const bytes = Buffer.from(await Bun.file(zipPath).bytes());
		const centralOffset = bytes.indexOf(CDFH_SIGNATURE);
		expect(centralOffset).toBeGreaterThanOrEqual(0);
		bytes.writeUInt32LE(0, centralOffset + 24);
		await writeFile(zipPath, bytes);

		const destination = path.join(tempDir, "forged-destination");
		await expect(
			safeExtractElpx(zipPath, destination, {
				...DEFAULT_ELPX_EXTRACT_LIMITS,
				maxTotalUncompressed: 1024,
				maxCompressionRatio: Number.MAX_SAFE_INTEGER,
			}),
		).rejects.toThrow(/tamaño máximo permitido/i);

		// Rollback removes the partial file and directory after the streaming
		// counter aborts extraction.
		expect(await pathExists(destination)).toBe(false);
	});
});
