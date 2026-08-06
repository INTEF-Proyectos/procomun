import { lstat, mkdir, open, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";

/**
 * Apertura segura de archivos .elpx (paquetes ZIP de eXeLearning).
 *
 * Un .elpx es un ZIP con HTML/JS/recursos de autor no confiable. Antes de
 * extraerlo en disco hay que defenderse de tres familias de ataque clásicas
 * sobre archivos comprimidos:
 *
 *   1. Zip slip / path traversal: una entrada con nombre `../../etc/passwd`,
 *      ruta absoluta o esquema `file://` puede escribir fuera del destino.
 *   2. Symlinks maliciosos: una entrada symlink que apunte fuera del destino
 *      convierte escrituras/lecturas posteriores en operaciones de ruta
 *      arbitraria.
 *   3. Zip bomb: un archivo pequeño que descomprime a gigabytes (o miles de
 *      entradas) y agota el disco.
 *
 * Este módulo porta a TypeScript las dos defensas del plugin de Moodle
 * `mod_exelearning` (`classes/local/zip_utils.php`: `is_unsafe_zip_entry` y
 * `assert_extraction_contained`) y añade inspección previa del directorio
 * central del ZIP para aplicar límites anti zip-bomb y rechazar symlinks ANTES
 * de extraer. Ver ADR-0026.
 */

export type ElpxExtractLimits = {
	/** Número máximo de entradas en el ZIP. */
	maxEntries: number;
	/** Tamaño total descomprimido máximo, en bytes. */
	maxTotalUncompressed: number;
	/** Ratio máximo total descomprimido/comprimido (guarda secundaria). */
	maxCompressionRatio: number;
};

export const DEFAULT_ELPX_EXTRACT_LIMITS: ElpxExtractLimits = {
	maxEntries: 5_000,
	maxTotalUncompressed: 500 * 1024 * 1024, // 500 MiB
	maxCompressionRatio: 500,
};

export type ZipEntryInfo = {
	name: string;
	uncompressedSize: number;
	compressedSize: number;
	/** Compression method: 0 = stored, 8 = deflate. */
	compressionMethod: number;
	flags: number;
	/** Offset of this entry's local file header, for readers that extract in memory. */
	localHeaderOffset: number;
	isSymlink: boolean;
};

const EOCD_SIGNATURE = 0x06054b50; // PK\x05\x06
const CDFH_SIGNATURE = 0x02014b50; // PK\x01\x02
const LFH_SIGNATURE = 0x04034b50; // PK\x03\x04
const ZIP64_SENTINEL = 0xffffffff;
const S_IFMT = 0xf000;
const S_IFLNK = 0xa000;
const ZIP_FLAG_ENCRYPTED = 0x0001;
const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;

/**
 * Entradas que nunca deben extraerse: nombre vacío, backslash (rutas Windows),
 * ruta absoluta, esquema `scheme://`, o traversal `..`.
 *
 * Port directo de `zip_utils.php::is_unsafe_zip_entry`.
 */
export function isUnsafeZipEntry(name: string): boolean {
	if (name === "") return true;
	// Null byte: en algunas capas de FS trunca el path y permite colisiones.
	if (name.includes("\0")) return true;
	if (name.includes("\\")) return true;
	if (name.startsWith("/")) return true;
	// Rutas absolutas estilo Windows (`C:/…`, `C:\…`) además de esquemas `://`.
	if (/^[a-zA-Z]:/.test(name)) return true;
	if (/^[a-zA-Z]+:\/\//.test(name)) return true;
	if (/(^|\/)\.\.(\/|$)/.test(name)) return true;
	return false;
}

function findEocdOffset(buf: Buffer): number {
	// El EOCD está al final; su comentario puede ocupar hasta 65535 bytes, así
	// que escaneamos hacia atrás buscando la firma. El mínimo EOCD son 22 bytes.
	const minOffset = Math.max(0, buf.length - (22 + 0xffff));
	for (let i = buf.length - 22; i >= minOffset; i--) {
		if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
			return i;
		}
	}
	return -1;
}

/**
 * Lee el directorio central del ZIP sin descomprimir nada. Devuelve, por cada
 * entrada, su nombre, tamaños, método, flags, offset local y si es un symlink.
 * Lanza error si el ZIP está corrupto o usa ZIP64 (eXeLearning no genera ZIP64;
 * lo tratamos como no soportado, fail-closed).
 */
export function readZipCentralDirectory(buf: Buffer): ZipEntryInfo[] {
	if (buf.length < 22 || buf.readUInt16LE(0) !== 0x4b50) {
		throw new Error("El archivo no es un ZIP válido");
	}

	const eocd = findEocdOffset(buf);
	if (eocd < 0) {
		throw new Error(
			"El archivo no es un .elpx válido (ZIP sin directorio central)",
		);
	}

	const totalEntries = buf.readUInt16LE(eocd + 10);
	let offset = buf.readUInt32LE(eocd + 16);
	if (offset === ZIP64_SENTINEL || totalEntries === 0xffff) {
		throw new Error("Archivo ZIP64 no soportado");
	}

	const entries: ZipEntryInfo[] = [];
	for (let i = 0; i < totalEntries; i++) {
		if (
			offset + 46 > buf.length ||
			buf.readUInt32LE(offset) !== CDFH_SIGNATURE
		) {
			throw new Error("Directorio central del ZIP corrupto");
		}

		const versionMadeBy = buf.readUInt16LE(offset + 4);
		const flags = buf.readUInt16LE(offset + 8);
		const compressionMethod = buf.readUInt16LE(offset + 10);
		const compressedSize = buf.readUInt32LE(offset + 20);
		const uncompressedSize = buf.readUInt32LE(offset + 24);
		const nameLen = buf.readUInt16LE(offset + 28);
		const extraLen = buf.readUInt16LE(offset + 30);
		const commentLen = buf.readUInt16LE(offset + 32);
		const externalAttr = buf.readUInt32LE(offset + 38);
		const localHeaderOffset = buf.readUInt32LE(offset + 42);

		if (
			compressedSize === ZIP64_SENTINEL ||
			uncompressedSize === ZIP64_SENTINEL ||
			localHeaderOffset === ZIP64_SENTINEL
		) {
			throw new Error("Archivo ZIP64 no soportado");
		}

		const nameEnd = offset + 46 + nameLen;
		if (nameEnd > buf.length) {
			throw new Error("Directorio central del ZIP corrupto");
		}
		const name = buf.toString("utf8", offset + 46, nameEnd);

		// El host está en el byte alto de "version made by"; 3 = Unix. Solo en ese
		// caso los 16 bits altos de los atributos externos llevan el modo Unix.
		const hostSystem = versionMadeBy >> 8;
		const unixMode = (externalAttr >>> 16) & 0xffff;
		const isSymlink = hostSystem === 3 && (unixMode & S_IFMT) === S_IFLNK;

		entries.push({
			name,
			uncompressedSize,
			compressedSize,
			compressionMethod,
			flags,
			localHeaderOffset,
			isSymlink,
		});

		offset += 46 + nameLen + extraLen + commentLen;
	}

	return entries;
}

/**
 * Inspecciona el manifiesto del .elpx y rechaza cualquier archivo peligroso
 * (nombre inseguro, symlink, cifrado, método no soportado o rutas duplicadas) o
 * que exceda los límites anti zip-bomb, ANTES de tocar el disco.
 */
export function inspectZipEntries(
	buf: Buffer,
	limits: ElpxExtractLimits = DEFAULT_ELPX_EXTRACT_LIMITS,
): ZipEntryInfo[] {
	const entries = readZipCentralDirectory(buf);

	if (entries.length > limits.maxEntries) {
		throw new Error(
			`El .elpx contiene demasiadas entradas (${entries.length} > ${limits.maxEntries})`,
		);
	}

	let totalUncompressed = 0;
	let totalCompressed = 0;
	const canonicalNames = new Set<string>();

	for (const entry of entries) {
		if (isUnsafeZipEntry(entry.name)) {
			throw new Error(`Entrada de ZIP no segura: ${entry.name}`);
		}
		if (entry.isSymlink) {
			throw new Error(`El .elpx contiene un enlace simbólico: ${entry.name}`);
		}
		if ((entry.flags & ZIP_FLAG_ENCRYPTED) !== 0) {
			throw new Error(
				`El .elpx contiene una entrada cifrada no soportada: ${entry.name}`,
			);
		}
		if (
			![ZIP_METHOD_STORE, ZIP_METHOD_DEFLATE].includes(entry.compressionMethod)
		) {
			throw new Error(`Método de compresión ZIP no soportado en ${entry.name}`);
		}

		const canonical = path.posix.normalize(entry.name).replace(/\/$/, "");
		if (canonical === "." || canonicalNames.has(canonical)) {
			throw new Error(
				`El .elpx contiene una ruta duplicada o ambigua: ${entry.name}`,
			);
		}
		canonicalNames.add(canonical);

		totalUncompressed += entry.uncompressedSize;
		totalCompressed += entry.compressedSize;
	}

	if (totalUncompressed > limits.maxTotalUncompressed) {
		throw new Error(
			`El .elpx descomprimido excede el tamaño máximo permitido (${totalUncompressed} > ${limits.maxTotalUncompressed} bytes)`,
		);
	}

	if (
		totalCompressed > 0 &&
		totalUncompressed / totalCompressed > limits.maxCompressionRatio
	) {
		throw new Error(
			`Ratio de compresión sospechoso (posible zip bomb): ${Math.round(totalUncompressed / totalCompressed)} > ${limits.maxCompressionRatio}`,
		);
	}

	return entries;
}

/**
 * Verifica que una extracción quedó completamente dentro de `dir`: ningún
 * symlink (podría apuntar fuera) y la ruta real de cada entrada contenida en la
 * ruta real de `dir`. También verifica el tamaño materializado como defensa en
 * profundidad; el límite autoritativo se aplica durante el streaming.
 */
export async function assertExtractionContained(
	dir: string,
	maxBytes: number = DEFAULT_ELPX_EXTRACT_LIMITS.maxTotalUncompressed,
): Promise<void> {
	const root = await realpath(dir);
	let totalBytes = 0;

	async function walk(current: string): Promise<void> {
		const dirents = await readdir(current, { withFileTypes: true });
		for (const dirent of dirents) {
			const full = path.join(current, dirent.name);

			// No seguir symlinks: inspeccionamos el enlace, no su destino.
			const stats = await lstat(full);
			if (stats.isSymbolicLink()) {
				throw new Error(`Extracción insegura: enlace simbólico en ${full}`);
			}

			const real = await realpath(full);
			const contained = real === root || real.startsWith(root + path.sep);
			if (!contained) {
				throw new Error(
					`Extracción insegura: ruta fuera del destino en ${full}`,
				);
			}

			if (stats.isDirectory()) {
				await walk(full);
			} else if (stats.isFile()) {
				totalBytes += stats.size;
				if (totalBytes > maxBytes) {
					throw new Error(
						`La extracción del .elpx excede el tamaño máximo permitido (${totalBytes} > ${maxBytes} bytes)`,
					);
				}
			}
		}
	}

	await walk(dir);
}

type ExtractionCounter = { bytes: number };

function entryCompressedBytes(buf: Buffer, entry: ZipEntryInfo): Uint8Array {
	const offset = entry.localHeaderOffset;
	if (offset + 30 > buf.length || buf.readUInt32LE(offset) !== LFH_SIGNATURE) {
		throw new Error(`Cabecera local ZIP corrupta para ${entry.name}`);
	}

	const localFlags = buf.readUInt16LE(offset + 6);
	const localMethod = buf.readUInt16LE(offset + 8);
	const nameLen = buf.readUInt16LE(offset + 26);
	const extraLen = buf.readUInt16LE(offset + 28);
	const nameStart = offset + 30;
	const dataStart = nameStart + nameLen + extraLen;
	const dataEnd = dataStart + entry.compressedSize;

	if (dataEnd > buf.length) {
		throw new Error(`Datos comprimidos fuera del ZIP para ${entry.name}`);
	}
	const localName = buf.toString("utf8", nameStart, nameStart + nameLen);
	if (
		localName !== entry.name ||
		localFlags !== entry.flags ||
		localMethod !== entry.compressionMethod
	) {
		throw new Error(`Cabecera local ZIP inconsistente para ${entry.name}`);
	}

	return new Uint8Array(
		buf.buffer,
		buf.byteOffset + dataStart,
		entry.compressedSize,
	);
}

async function extractFileEntry(
	buf: Buffer,
	entry: ZipEntryInfo,
	target: string,
	counter: ExtractionCounter,
	maxBytes: number,
): Promise<void> {
	const compressed = entryCompressedBytes(buf, entry);
	// Se copia a un Uint8Array respaldado por un ArrayBuffer propio: los tipos de
	// BlobPart y de DecompressionStream exigen Uint8Array<ArrayBuffer>, y lo que
	// devuelve entryCompressedBytes es Uint8Array<ArrayBufferLike> (puede venir de
	// un SharedArrayBuffer). La copia hace explícito el requisito en vez de
	// afirmarlo con un cast.
	const compressedBytes = new Uint8Array(compressed);
	let stream: ReadableStream<Uint8Array<ArrayBuffer>> = new Blob([
		compressedBytes,
	]).stream() as ReadableStream<Uint8Array<ArrayBuffer>>;
	if (entry.compressionMethod === ZIP_METHOD_DEFLATE) {
		stream = stream.pipeThrough(new DecompressionStream("deflate-raw"));
	}

	const file = await open(target, "wx");
	let entryBytes = 0;
	try {
		const reader = stream.getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value || value.byteLength === 0) continue;

			// Comprobar ANTES de acumular/escribir: un único chunk enorme no debe
			// ni siquiera contarse como materializado más allá del límite.
			const nextTotal = counter.bytes + value.byteLength;
			if (nextTotal > maxBytes) {
				await reader.cancel();
				throw new Error(
					`La extracción del .elpx excede el tamaño máximo permitido (${nextTotal} > ${maxBytes} bytes)`,
				);
			}
			entryBytes += value.byteLength;
			counter.bytes = nextTotal;
			await file.write(value);
		}
	} finally {
		await file.close();
	}

	// El directorio central puede mentir: si el tamaño real no coincide con el
	// declarado, fallamos cerrados (corrupción o forgery). La cota autoritativa
	// de disco es el contador de streaming de arriba.
	if (entryBytes !== entry.uncompressedSize) {
		throw new Error(
			`Tamaño descomprimido inconsistente para ${entry.name} (${entryBytes} != ${entry.uncompressedSize})`,
		);
	}
}

/**
 * Extrae un .elpx de forma segura en `extractPath`:
 *   1. Inspecciona el directorio central y rechaza entradas peligrosas.
 *   2. Descomprime cada entrada en streaming, contando bytes reales antes de
 *      escribirlos para que una bomba no pueda llenar el disco.
 *   3. Verifica que lo materializado quedó contenido (defensa en profundidad).
 *
 * Ante cualquier fallo hace rollback (borra `extractPath`) para no dejar una
 * extracción parcial o insegura en disco.
 */
export async function safeExtractElpx(
	filePath: string,
	extractPath: string,
	limits: ElpxExtractLimits = DEFAULT_ELPX_EXTRACT_LIMITS,
): Promise<void> {
	const buf = Buffer.from(await Bun.file(filePath).bytes());

	try {
		const entries = inspectZipEntries(buf, limits);
		await mkdir(extractPath, { recursive: true });
		const root = path.resolve(extractPath);
		const counter: ExtractionCounter = { bytes: 0 };

		for (const entry of entries) {
			const target = path.resolve(root, entry.name);
			if (target !== root && !target.startsWith(root + path.sep)) {
				throw new Error(`Entrada de ZIP no segura: ${entry.name}`);
			}

			if (entry.name.endsWith("/")) {
				await mkdir(target, { recursive: true });
				continue;
			}

			await mkdir(path.dirname(target), { recursive: true });
			await extractFileEntry(
				buf,
				entry,
				target,
				counter,
				limits.maxTotalUncompressed,
			);
		}

		await assertExtractionContained(extractPath, limits.maxTotalUncompressed);
	} catch (error) {
		await rm(extractPath, { recursive: true, force: true });
		throw error;
	}
}
