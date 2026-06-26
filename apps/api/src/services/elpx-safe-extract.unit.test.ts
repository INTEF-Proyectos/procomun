import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, readdir, symlink, access } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
	isUnsafeZipEntry,
	readZipCentralDirectory,
	inspectZipEntries,
	assertExtractionContained,
	safeExtractElpx,
	DEFAULT_ELPX_EXTRACT_LIMITS,
} from "./elpx-safe-extract.ts";

// --- Helper: crea ZIPs arbitrarios (incl. entradas maliciosas) vía python ---
// El CLI `python3 -m zipfile` no permite inyectar nombres con `..` ni symlinks,
// así que usamos un script que controla arcname y atributos externos.

type RawZipSpec = {
	files?: Record<string, string>;
	/** name -> tamaño en bytes (relleno de ceros, alta compresión). */
	bigFiles?: Record<string, number>;
	/** name -> destino del enlace simbólico. */
	symlinks?: Record<string, string>;
};

const PY_BUILDER = `
import sys, json, zipfile
spec = json.loads(sys.argv[1])
zp = sys.argv[2]
with zipfile.ZipFile(zp, "w", zipfile.ZIP_DEFLATED) as z:
    for name, data in spec.get("files", {}).items():
        z.writestr(name, data)
    for name, size in spec.get("bigFiles", {}).items():
        z.writestr(name, b"\\0" * int(size))
    for name, target in spec.get("symlinks", {}).items():
        zi = zipfile.ZipInfo(name)
        zi.create_system = 3  # Unix
        zi.external_attr = (0xA1FF) << 16  # S_IFLNK | 0777
        z.writestr(zi, target)
`;

async function createRawZip(zipPath: string, spec: RawZipSpec): Promise<void> {
	const proc = Bun.spawn(
		["python3", "-c", PY_BUILDER, JSON.stringify(spec), zipPath],
		{ stdout: "ignore", stderr: "pipe" },
	);
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		const err = await new Response(proc.stderr).text();
		throw new Error(`python zip builder failed: ${err}`);
	}
}

async function pathExists(p: string): Promise<boolean> {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
}

let tempDir: string;

beforeAll(async () => {
	tempDir = await mkdtemp(path.join(tmpdir(), "elpx-safe-"));
});

afterAll(async () => {
	await rm(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// isUnsafeZipEntry
// ---------------------------------------------------------------------------
describe("isUnsafeZipEntry", () => {
	it("acepta nombres normales", () => {
		expect(isUnsafeZipEntry("index.html")).toBe(false);
		expect(isUnsafeZipEntry("css/style.css")).toBe(false);
		expect(isUnsafeZipEntry("images/a/b/c.png")).toBe(false);
		expect(isUnsafeZipEntry("content.xml")).toBe(false);
	});

	it("rechaza nombre vacío", () => {
		expect(isUnsafeZipEntry("")).toBe(true);
	});

	it("rechaza traversal con ..", () => {
		expect(isUnsafeZipEntry("../evil.txt")).toBe(true);
		expect(isUnsafeZipEntry("a/../../evil.txt")).toBe(true);
		expect(isUnsafeZipEntry("foo/..")).toBe(true);
		expect(isUnsafeZipEntry("..")).toBe(true);
	});

	it("rechaza ruta absoluta", () => {
		expect(isUnsafeZipEntry("/etc/passwd")).toBe(true);
	});

	it("rechaza backslash (rutas Windows)", () => {
		expect(isUnsafeZipEntry("a\\b\\c.txt")).toBe(true);
	});

	it("rechaza esquemas scheme://", () => {
		expect(isUnsafeZipEntry("file:///etc/passwd")).toBe(true);
		expect(isUnsafeZipEntry("http://example.com/x")).toBe(true);
	});

	it("no confunde nombres con .. embebido legítimo", () => {
		expect(isUnsafeZipEntry("file..name.txt")).toBe(false);
		expect(isUnsafeZipEntry("a/b..c/d.txt")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// readZipCentralDirectory / inspectZipEntries
// ---------------------------------------------------------------------------
describe("readZipCentralDirectory", () => {
	it("lista las entradas de un ZIP normal con sus tamaños", async () => {
		const zipPath = path.join(tempDir, "normal.zip");
		await createRawZip(zipPath, {
			files: {
				"content.xml": "<ode/>",
				"index.html": "<html></html>",
				"css/style.css": "body{}",
			},
		});

		const buf = Buffer.from(await Bun.file(zipPath).bytes());
		const entries = readZipCentralDirectory(buf);

		const names = entries.map((e) => e.name).sort();
		expect(names).toEqual(["content.xml", "css/style.css", "index.html"]);
		const index = entries.find((e) => e.name === "index.html");
		expect(index?.uncompressedSize).toBe("<html></html>".length);
		expect(index?.isSymlink).toBe(false);
	});

	it("detecta entradas symlink mediante el modo Unix", async () => {
		const zipPath = path.join(tempDir, "symlink-cd.zip");
		await createRawZip(zipPath, {
			files: { "content.xml": "<ode/>" },
			symlinks: { evil: "/etc/passwd" },
		});

		const buf = Buffer.from(await Bun.file(zipPath).bytes());
		const entries = readZipCentralDirectory(buf);
		const link = entries.find((e) => e.name === "evil");
		expect(link?.isSymlink).toBe(true);
	});

	it("rechaza datos que no son un ZIP", () => {
		expect(() => readZipCentralDirectory(Buffer.from("not a zip"))).toThrow();
	});
});

describe("inspectZipEntries", () => {
	it("acepta un .elpx legítimo", async () => {
		const zipPath = path.join(tempDir, "ok.zip");
		await createRawZip(zipPath, {
			files: { "content.xml": "<ode/>", "index.html": "<html></html>" },
		});
		const buf = Buffer.from(await Bun.file(zipPath).bytes());
		const entries = inspectZipEntries(buf);
		expect(entries.length).toBe(2);
	});

	it("rechaza zip slip (entrada con ../)", async () => {
		const zipPath = path.join(tempDir, "slip.zip");
		await createRawZip(zipPath, {
			files: { "content.xml": "<ode/>", "../evil.txt": "pwned" },
		});
		const buf = Buffer.from(await Bun.file(zipPath).bytes());
		expect(() => inspectZipEntries(buf)).toThrow(/no segura/i);
	});

	it("rechaza symlinks antes de extraer", async () => {
		const zipPath = path.join(tempDir, "symlink.zip");
		await createRawZip(zipPath, {
			files: { "content.xml": "<ode/>" },
			symlinks: { evil: "/etc/passwd" },
		});
		const buf = Buffer.from(await Bun.file(zipPath).bytes());
		expect(() => inspectZipEntries(buf)).toThrow(/enlace simbólico/i);
	});

	it("rechaza demasiadas entradas (zip bomb por número)", async () => {
		const zipPath = path.join(tempDir, "many.zip");
		const files: Record<string, string> = {};
		for (let i = 0; i < 20; i++) files[`f${i}.txt`] = "x";
		await createRawZip(zipPath, { files });
		const buf = Buffer.from(await Bun.file(zipPath).bytes());
		expect(() =>
			inspectZipEntries(buf, { ...DEFAULT_ELPX_EXTRACT_LIMITS, maxEntries: 10 }),
		).toThrow(/demasiadas entradas/i);
	});

	it("rechaza tamaño descomprimido excesivo", async () => {
		const zipPath = path.join(tempDir, "big.zip");
		await createRawZip(zipPath, { bigFiles: { "big.bin": 64 * 1024 } });
		const buf = Buffer.from(await Bun.file(zipPath).bytes());
		expect(() =>
			inspectZipEntries(buf, {
				...DEFAULT_ELPX_EXTRACT_LIMITS,
				maxTotalUncompressed: 1024,
			}),
		).toThrow(/tamaño máximo/i);
	});

	it("rechaza ratio de compresión sospechoso (zip bomb)", async () => {
		const zipPath = path.join(tempDir, "ratio.zip");
		await createRawZip(zipPath, { bigFiles: { "zeros.bin": 64 * 1024 } });
		const buf = Buffer.from(await Bun.file(zipPath).bytes());
		expect(() =>
			inspectZipEntries(buf, {
				...DEFAULT_ELPX_EXTRACT_LIMITS,
				maxCompressionRatio: 2,
			}),
		).toThrow(/zip bomb|ratio/i);
	});
});

// ---------------------------------------------------------------------------
// assertExtractionContained
// ---------------------------------------------------------------------------
describe("assertExtractionContained", () => {
	it("acepta un árbol normal", async () => {
		const dir = path.join(tempDir, "contained-ok");
		await mkdir(path.join(dir, "css"), { recursive: true });
		await writeFile(path.join(dir, "index.html"), "<html></html>");
		await writeFile(path.join(dir, "css", "style.css"), "body{}");
		await expect(assertExtractionContained(dir)).resolves.toBeUndefined();
	});

	it("rechaza cualquier symlink en el árbol", async () => {
		const dir = path.join(tempDir, "contained-symlink");
		await mkdir(dir, { recursive: true });
		await writeFile(path.join(dir, "index.html"), "<html></html>");
		await symlink("/etc/passwd", path.join(dir, "leak"));
		await expect(assertExtractionContained(dir)).rejects.toThrow(
			/enlace simbólico/i,
		);
	});

	// Anti zip-bomb autoritativo: mide el tamaño REAL materializado, no el
	// declarado en el directorio central (que el atacante puede forjar a 0).
	it("rechaza cuando el tamaño real extraído supera maxBytes", async () => {
		const dir = path.join(tempDir, "contained-toobig");
		await mkdir(dir, { recursive: true });
		// 2 KiB reales en disco frente a un límite de 1 KiB.
		await writeFile(path.join(dir, "payload.bin"), Buffer.alloc(2 * 1024));
		await expect(assertExtractionContained(dir, 1024)).rejects.toThrow(
			/tamaño máximo permitido/i,
		);
	});

	it("acepta cuando el tamaño real extraído está bajo maxBytes", async () => {
		const dir = path.join(tempDir, "contained-undersize");
		await mkdir(dir, { recursive: true });
		await writeFile(path.join(dir, "payload.bin"), Buffer.alloc(2 * 1024));
		await expect(
			assertExtractionContained(dir, 64 * 1024),
		).resolves.toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// safeExtractElpx
// ---------------------------------------------------------------------------
describe("safeExtractElpx", () => {
	it("extrae un .elpx válido", async () => {
		const zipPath = path.join(tempDir, "valid-extract.elpx");
		await createRawZip(zipPath, {
			files: {
				"content.xml": "<ode/>",
				"index.html": "<html></html>",
				"css/style.css": "body{}",
			},
		});
		const dest = path.join(tempDir, "extract-ok");
		await mkdir(dest, { recursive: true });

		await safeExtractElpx(zipPath, dest);

		const files = await readdir(dest);
		expect(files).toContain("index.html");
		expect(files).toContain("content.xml");
		expect(files).toContain("css");
	});

	it("bloquea zip slip y hace rollback sin escribir fuera del destino", async () => {
		const zipPath = path.join(tempDir, "slip-extract.elpx");
		await createRawZip(zipPath, {
			files: { "content.xml": "<ode/>", "../escaped.txt": "pwned" },
		});
		const dest = path.join(tempDir, "extract-slip", "inner");
		await mkdir(dest, { recursive: true });

		await expect(safeExtractElpx(zipPath, dest)).rejects.toThrow(/no segura/i);

		// rollback: el destino se eliminó y nada se escribió en el padre.
		expect(await pathExists(dest)).toBe(false);
		expect(
			await pathExists(path.join(tempDir, "extract-slip", "escaped.txt")),
		).toBe(false);
	});
});
